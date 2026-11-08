// «مقایسهٔ نسخه‌ها» (kb/diff?article=…&a=…&b=…): two versions of an article side by side, field by field (title,
// summary, body, internal section, keywords) as a line diff — added lines on a quiet tint, removed ones struck
// through — with the counts of each field. Defaults: the published version against the newest one.
import "./knowledge.css";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { recordsApi } from "../../records";
import { KB_KEYS, kbApi } from "./api";
import { faNum } from "./model";

const STATE: Record<string, string> = { draft: "پیش‌نویس", in_review: "در بازبینی", scheduled: "زمان‌بندی‌شده", published: "منتشرشده", outdated: "منسوخ", discarded: "کنار گذاشته" };

export default function DiffPage() {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const article = sp.get("article") ?? "";
  const versions = useQuery({
    queryKey: ["knowledge", orgId, "versions", article],
    queryFn: () => recordsApi.list(api, "kb_version", { filter: { f: "article_id", op: "eq", v: article }, fields: ["version_label", "state", "change_note", "updated_at"], size: 100, sort: "-major,-minor,-created_at" }),
    enabled: !!article,
  });
  const rows = versions.data?.rows ?? [];
  const published = rows.find((r) => r.state === "published")?.id;
  const a = sp.get("a") || published || rows[1]?.id || "";
  const b = sp.get("b") || rows[0]?.id || "";
  const d = useQuery({ queryKey: KB_KEYS.diff(orgId, a, b), queryFn: () => kbApi.diff(api, a, b), enabled: !!a && !!b && a !== b });
  const options = useMemo(() => rows.map((r) => ({ value: r.id, label: `نسخهٔ ${faNum(String(r.version_label ?? ""))}، ${STATE[String(r.state)] ?? r.state}${r.change_note ? `، ${String(r.change_note).slice(0, 40)}` : ""}` })), [rows]);
  const pick = (k: "a" | "b", v: string) => {
    const next = new URLSearchParams(sp);
    next.set(k, v);
    setSp(next, { replace: true });
  };
  return (
    <div>
      <PageHeader title="مقایسهٔ نسخه‌ها" back={article ? `/${orgId}/kb/a/${article}` : `/${orgId}/kb`} />
      {!article ? <EmptyState title="مقاله‌ای انتخاب نشده است" /> : null}
      {versions.isLoading ? <Loader /> : null}
      {rows.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select className="min-w-60" value={a || undefined} onChange={(v) => pick("a", v)} options={options} aria-label="نسخهٔ پیشین" placeholder="نسخهٔ پیشین" />
          <span className="text-ink-3">در برابر</span>
          <Select className="min-w-60" value={b || undefined} onChange={(v) => pick("b", v)} options={options} aria-label="نسخهٔ تازه" placeholder="نسخهٔ تازه" />
        </div>
      ) : null}
      {rows.length < 2 && !versions.isLoading && article ? <EmptyState title="این مقاله هنوز یک نسخه بیشتر ندارد" /> : null}
      {a && b && a === b ? <p className="text-[13px] text-ink-3">دو نسخهٔ متفاوت انتخاب کنید.</p> : null}
      {d.isLoading ? <Loader /> : null}
      {d.data ? (
        <div className="flex flex-col gap-4">
          {d.data.fields.map((f) => (
            <Card
              key={f.field}
              title={f.label}
              meta={
                f.added || f.removed ? (
                  <span className="text-[12px] text-ink-3">
                    <span className="ds-num text-in">+{faNum(f.added)}</span> / <span className="ds-num text-danger">−{faNum(f.removed)}</span>
                  </span>
                ) : (
                  <span className="text-[12px] text-ink-3">بی‌تغییر</span>
                )
              }
            >
              {f.added || f.removed ? (
                <div className="overflow-x-auto rounded-md border border-line text-[13px] leading-6" role="table" aria-label={`تفاوت ${f.label}`}>
                  {f.lines.map((l, i) => (
                    <div key={i} role="row" className={`whitespace-pre-wrap px-3 ${l.op === "add" ? "bg-in-tint" : l.op === "del" ? "bg-danger-tint text-ink-3 line-through" : "text-ink-2"}`}>
                      <span className="me-2 inline-block w-3 select-none text-ink-3" aria-hidden>
                        {l.op === "add" ? "+" : l.op === "del" ? "−" : " "}
                      </span>
                      {l.text || " "}
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
