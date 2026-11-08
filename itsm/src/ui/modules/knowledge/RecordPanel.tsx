// «دانش» beside a record (incidents, problems, requests, changes — any task table with links): the articles linked to
// it (with how: solved by, workaround, related), suggestions from its text searched with the caller's access (refine
// with your own words), short answers, «حل شد با این مقاله» (counts the article's reuse once per record), sharing an
// article with the requester as a reply (never an internal one), and — KCS — «نوشتن مقاله از این رکورد» (a draft from
// its description and resolution, people scrubbed) or a work-in-progress article when nothing was found.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Input, Modal, Tooltip } from "antd";
import { BookPlus, Check, CornerDownLeft, FilePen, Lock, MoreHorizontal, Search, Unlink } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { recordsApi, type RecordContext } from "../../records";
import { KB_KEYS, kbApi, kbSession, useKbRefresh } from "./api";
import { LINK_KINDS } from "./model";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function RecordPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refresh = useKbRefresh();
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [detach, setDetach] = useState<{ link_id: string; title: string } | null>(null);
  const [reason, setReason] = useState("");
  const table = ctx.table;
  const id = ctx.row.id;
  const p = useQuery({ queryKey: [...KB_KEYS.record(orgId, table, id), asked], queryFn: () => kbApi.record(api, table, id, asked || null), staleTime: 60_000 });
  const done = () => {
    void p.refetch();
    void refresh();
  };
  const attach = useAction((a: { article: string; kind: (typeof LINK_KINDS)[number]["value"] }) => kbApi.attach(api, table, id, a.article, a.kind, asked || p.data?.query || null), {
    success: (d) => (d.already ? "این مقاله پیش‌تر پیوند شده بود" : "مقاله به این رکورد پیوند شد"),
    onSuccess: () => {
      done();
      ctx.refresh();
    },
  });
  const unlink = useAction(() => kbApi.detach(api, table, id, detach!.link_id, reason), {
    success: "پیوند مقاله برداشته شد",
    onSuccess: () => {
      setDetach(null);
      setReason("");
      done();
      ctx.refresh();
    },
  });
  const share = useAction((a: { id: string; title: string }) => recordsApi.addJournal(api, table, id, { kind: "comment", body: `این راهنما ممکن است به کارتان بیاید: [${a.title.replace(/[[\]]/g, "")}](/${orgId}/kb/a/${a.id})` }), {
    success: "پیوند مقاله در پاسخ به درخواست‌کننده فرستاده شد",
    onSuccess: () => ctx.refresh(),
  });
  const capture = useAction((wip: boolean) => kbApi.capture(api, { table, id, wip, title: wip ? asked || p.data?.query || null : null }), {
    success: (d) => (d.article.kcs_confidence === "wip" ? "مقالهٔ در حال کار ساخته شد" : "پیش‌نویس مقاله از این رکورد ساخته شد"),
    onSuccess: (d) => {
      done();
      if (d.version) nav(`/${orgId}/kb/edit/${d.version.id}`);
    },
  });
  if (p.isLoading) return <Loader />;
  const d = p.data;
  if (!d) return <p className="text-[13px] text-ink-3">{p.error ? "دانش این رکورد در دسترس نیست." : ""}</p>;
  const linkedIds = new Set(d.linked.map((l) => l.article.id));
  return (
    <div className="flex flex-col gap-3">
      {d.linked.length ? (
        <ul className="flex flex-col gap-1.5">
          {d.linked.map((l) => (
            <li key={l.link_id} className="flex items-center gap-2 text-[13px]">
              <Check {...I14} className="shrink-0 text-in" />
              <Link to={`/${orgId}/kb/a/${l.article.id}`} className="ds-link min-w-0 flex-1 truncate" title={l.article.title}>
                {l.article.title}
              </Link>
              <span className="shrink-0 text-[12px] text-ink-3">{l.label}</span>
              {d.can.link ? (
                <Tooltip title="برداشتن پیوند">
                  <Button size="small" type="text" icon={<Unlink {...I14} />} onClick={() => setDetach({ link_id: l.link_id, title: l.article.title })} aria-label="برداشتن پیوند" />
                </Tooltip>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(q.trim());
        }}
      >
        <Input size="small" value={q} onChange={(e) => setQ(e.target.value)} placeholder={d.query ? `جست‌وجو (اکنون: ${d.query.slice(0, 40)})` : "جست‌وجو در دانش"} maxLength={300} aria-label="جست‌وجو در دانش برای این رکورد" />
        <Button size="small" htmlType="submit" icon={<Search {...I14} />} aria-label="جست‌وجو" />
      </form>

      {d.snippets.map((s) => (
        <div key={s.id} className="rounded-md bg-sunken px-2.5 py-2 text-[13px]">
          <div className="font-medium text-ink">{s.question}</div>
          <p className="m-0 mt-0.5 line-clamp-4 whitespace-pre-wrap text-ink-2">{s.answer}</p>
        </div>
      ))}

      {d.suggestions.length ? (
        <ul className="flex flex-col gap-2">
          {d.suggestions.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 rounded-md bg-sunken px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {s.internal ? <Lock size={12} strokeWidth={1.4} className="shrink-0 text-ink-3" aria-label="فقط کارشناسان" /> : null}
                <a
                  href={`/${orgId}/kb/a/${s.id}`}
                  target="_blank"
                  rel="noopener"
                  className="ds-link min-w-0 truncate text-[13px]"
                  onClick={() => void kbApi.click(api, s.id, d.query, null, kbSession(), "record").catch(() => undefined)}
                >
                  {s.title}
                </a>
              </div>
              {s.snippet ? <p className="m-0 line-clamp-2 text-[12px] text-ink-3">{s.snippet}</p> : null}
              {d.can.link && !linkedIds.has(s.id) ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <Button size="small" icon={<Check {...I14} />} onClick={() => attach.mutate({ article: s.id, kind: "kb_solved_by" })} loading={attach.isPending && attach.variables?.article === s.id}>
                    حل شد با این مقاله
                  </Button>
                  {!s.internal ? (
                    <Tooltip title="پیوند مقاله را در پاسخ به درخواست‌کننده می‌فرستد">
                      <Button size="small" type="text" icon={<CornerDownLeft {...I14} />} onClick={() => share.mutate({ id: s.id, title: s.title })} loading={share.isPending && share.variables?.id === s.id}>
                        فرستادن
                      </Button>
                    </Tooltip>
                  ) : null}
                  <Dropdown trigger={["click"]} menu={{ items: LINK_KINDS.filter((k) => k.value !== "kb_solved_by").map((k) => ({ key: k.value, label: k.label, onClick: () => attach.mutate({ article: s.id, kind: k.value }) })) }}>
                    <Button size="small" type="text" icon={<MoreHorizontal {...I14} />} aria-label="پیوندهای دیگر" />
                  </Dropdown>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-3">مقالهٔ مرتبطی پیدا نشد.</p>
      )}

      {d.captured ? (
        <Link to={`/${orgId}/kb/a/${d.captured.id}`} className="ds-link flex items-center gap-1.5 text-[13px]">
          <FilePen {...I14} /> مقالهٔ ساخته‌شده از این رکورد: {d.captured.title}
        </Link>
      ) : d.can.capture ? (
        <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
          <Button size="small" icon={<BookPlus {...I14} />} onClick={() => capture.mutate(false)} loading={capture.isPending && capture.variables === false}>
            نوشتن مقاله از این رکورد
          </Button>
          {!d.suggestions.length ? (
            <Tooltip title="مقالهٔ کوتاهِ «در حال کار» تا همکارانی که همین را جست‌وجو می‌کنند آن را ببینند و کامل کنند">
              <Button size="small" type="text" onClick={() => capture.mutate(true)} loading={capture.isPending && capture.variables === true}>
                مقالهٔ در حال کار
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      <Modal open={!!detach} title="برداشتن پیوند مقاله" okText="برداشتن" okButtonProps={{ danger: true, disabled: reason.trim().length < 3 }} cancelText="انصراف" onOk={() => unlink.mutate()} confirmLoading={unlink.isPending} onCancel={() => setDetach(null)} destroyOnHidden>
        <p className="mb-2 text-[13px] text-ink-2">«{detach?.title}» از این رکورد جدا می‌شود و دلیل آن یادداشت داخلی رکورد می‌شود.</p>
        <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="چرا این مقاله به این رکورد نمی‌خورد؟" aria-label="دلیل" />
      </Modal>
    </div>
  );
}
