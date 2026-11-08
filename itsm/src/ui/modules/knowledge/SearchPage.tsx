// «جست‌وجو در دانش» (kb/search): results of the Persian-aware search over the articles the member may read — short
// answers first, then articles with their matching words marked, why they came (pinned by a rule, found by meaning),
// facets by base, category, type and language, sorting, paging, and the honest notes: some words only (relaxed), the
// glossary's synonyms used. Nothing found: report the gap, or — for authors — start the article it asks for.
import "./knowledge.css";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Pagination, Segmented, Select, Tag, Tooltip } from "antd";
import { BookOpenText, Lock, MessageSquareQuote, Pin, Plus, Sparkles } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { EmptyState, JDate, Loader } from "../../components/display";
import { KB_KEYS, kbApi, kbSession, useKbHome, useKbMeta } from "./api";
import { Marked, SearchBox } from "./SearchBox";
import { faNum, languageLabel, readSearch, writeSearch } from "./model";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const SIZE = 15;

export default function SearchPage() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const st = useMemo(() => readSearch(sp), [sp]);
  const meta = useKbMeta();
  const home = useKbHome();
  const [gap, setGap] = useState("");
  const r = useQuery({
    queryKey: KB_KEYS.search(orgId, sp.toString()),
    queryFn: () => kbApi.search(api, { q: st.q, base: st.base, category: st.category, type: st.type, language: st.language, sort: st.sort, page: st.page, size: SIZE, session: kbSession(), channel: "search" }),
    placeholderData: (prev) => prev,
  });
  const set = (patch: Parameters<typeof writeSearch>[1]) => setSp(writeSearch(st, patch));
  const report = useAction(() => kbApi.reportGap(api, gap || st.q), { success: "سپاس؛ کمبود این دانش به مسئولان رسید", onSuccess: () => setGap("") });
  const types = meta.data?.types ?? [];
  const typeLabel = (k: string) => types.find((t) => t.value === k)?.label ?? k;
  const res = r.data;
  const facetSelect = (label: string, value: string | null, options: { value: string; label: string }[], key: "base" | "category" | "type" | "language") =>
    options.length > 1 || value ? (
      <Select
        size="small"
        className="min-w-36"
        allowClear
        placeholder={label}
        value={value ?? undefined}
        onChange={(v) => set({ [key]: v ?? null })}
        options={options}
        aria-label={label}
        popupMatchSelectWidth={false}
      />
    ) : null;
  const open = (id: string, pos: number) => {
    void kbApi.click(api, id, st.q || null, pos, kbSession(), "search").catch(() => undefined);
    nav(`/${orgId}/kb/a/${id}${st.q ? `?q=${encodeURIComponent(st.q)}` : ""}`);
  };
  return (
    <div>
      <PageHeader
        title="جست‌وجو در دانش"
        back={`/${orgId}/kb`}
        actions={
          home.data?.can.author ? (
            <Button icon={<Plus {...I16} />} onClick={() => nav(`/${orgId}/kb/new${st.q ? `?title=${encodeURIComponent(st.q)}` : ""}`)}>
              مقالهٔ تازه
            </Button>
          ) : null
        }
      />
      <div className="mb-4 max-w-3xl">
        <SearchBox initial={st.q} size="middle" onSearch={(q) => set({ q })} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {facetSelect("پایگاه", st.base, (res?.facets.base ?? []).map((f) => ({ value: f.key, label: `${f.label} (${faNum(f.count)})` })), "base")}
        {facetSelect("دسته", st.category, (res?.facets.category ?? []).map((f) => ({ value: f.key, label: `${f.label} (${faNum(f.count)})` })), "category")}
        {facetSelect("نوع", st.type, (res?.facets.type ?? []).map((f) => ({ value: f.key, label: `${typeLabel(f.key)} (${faNum(f.count)})` })), "type")}
        {facetSelect("زبان", st.language, (res?.facets.language ?? []).map((f) => ({ value: f.key, label: `${languageLabel(f.key)} (${faNum(f.count)})` })), "language")}
        <Segmented
          size="small"
          className="ms-auto"
          value={st.sort}
          onChange={(v) => set({ sort: v as typeof st.sort })}
          options={[
            { value: "relevance", label: "مرتبط‌ترین" },
            { value: "recent", label: "تازه‌ترین" },
            { value: "popular", label: "پراستفاده‌ترین" },
          ]}
        />
      </div>

      {r.isLoading ? <Loader /> : null}
      {res ? (
        <div className="flex max-w-3xl flex-col gap-4">
          {res.expanded.length ? <p className="m-0 text-[13px] text-ink-3">هم‌معنی‌های واژه‌نامه هم جست‌وجو شد: {res.expanded.join("، ")}</p> : null}
          {res.relaxed ? <Note>هیچ مقاله‌ای همهٔ واژه‌ها را نداشت؛ مقاله‌هایی با بخشی از آن‌ها آمده است.</Note> : null}

          {res.snippets.map((s) => (
            <div key={s.id} className="kb-answer">
              <div className="mb-1 flex items-center gap-2 text-[12px] text-ink-3">
                <MessageSquareQuote {...I14} /> پاسخ کوتاه
                {s.internal ? <Lock size={12} strokeWidth={1.4} aria-label="فقط کارشناسان" /> : null}
              </div>
              <div className="ds-t-title mb-1">{s.question}</div>
              <p className="m-0 whitespace-pre-wrap text-[14px] text-ink-2">{s.answer}</p>
              {s.source_article_id ? (
                <Link className="ds-link mt-2 inline-block text-[13px]" to={`/${orgId}/kb/a/${s.source_article_id}`}>
                  مقالهٔ کامل
                </Link>
              ) : null}
            </div>
          ))}

          {res.hits.length ? (
            <Card flush>
              <div className="px-4">
                <p className="m-0 pt-3 text-[12px] text-ink-3">
                  <span className="ds-num">{faNum(res.total)}</span> مقاله
                  {res.semantic ? " · همراه با مقاله‌هایی که از معنای پرسش پیدا شد" : ""}
                </p>
                {res.hits.map((h, i) => (
                  <div key={h.id} className="kb-hit">
                    <a
                      href={`/${orgId}/kb/a/${h.id}`}
                      className="kb-hit-title"
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        open(h.id, (st.page - 1) * SIZE + i);
                      }}
                    >
                      <Marked text={h.title} terms={res.terms} />
                    </a>
                    {h.snippet ? (
                      <p className="kb-hit-snippet">
                        <Marked text={h.snippet} terms={res.terms} />
                      </p>
                    ) : null}
                    <div className="kb-hit-meta">
                      {h.pinned ? (
                        <span className="inline-flex items-center gap-1">
                          <Pin size={12} strokeWidth={1.4} /> پیشنهاد مسئولان دانش
                        </span>
                      ) : null}
                      {h.semantic ? (
                        <Tooltip title="واژه‌های پرسش در این مقاله نیست؛ معنایش نزدیک است">
                          <span className="inline-flex items-center gap-1">
                            <Sparkles size={12} strokeWidth={1.4} /> از معنای پرسش
                          </span>
                        </Tooltip>
                      ) : null}
                      {h.wip ? <Tag variant="filled">در حال نوشتن (KCS)</Tag> : null}
                      {h.internal ? (
                        <span className="inline-flex items-center gap-1">
                          <Lock size={12} strokeWidth={1.4} /> فقط کارشناسان
                        </span>
                      ) : null}
                      {h.base_name ? <span>{h.base_name}</span> : null}
                      {h.category_name ? <span>{h.category_name}</span> : null}
                      {h.article_type ? <span>{typeLabel(h.article_type)}</span> : null}
                      {h.published_at ? (
                        <span>
                          <JDate v={h.published_at} />
                        </span>
                      ) : null}
                      {h.reuse_count ? <span><span className="ds-num">{faNum(h.reuse_count)}</span> بار به کار رفته</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : !res.snippets.length ? (
            <EmptyState
              icon={BookOpenText}
              title={st.q ? `برای «${st.q}» مقاله‌ای پیدا نشد` : "مقاله‌ای نیست"}
              description={st.q ? "واژه‌های دیگری را امتحان کنید، یا بگویید چه دانشی کم است تا مسئولان آن را بنویسند." : undefined}
              action={
                st.q ? (
                  <div className="flex w-full max-w-md flex-col gap-2">
                    <Input value={gap || st.q} onChange={(e) => setGap(e.target.value)} maxLength={250} aria-label="موضوع دانشی که کم است" />
                    <Button onClick={() => report.mutate()} loading={report.isPending}>
                      گزارش کمبود دانش
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : null}

          {res.total > SIZE ? (
            <Pagination className="self-center" current={st.page} pageSize={SIZE} total={Math.min(res.total, 200 * SIZE)} showSizeChanger={false} onChange={(p) => set({ page: p })} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
