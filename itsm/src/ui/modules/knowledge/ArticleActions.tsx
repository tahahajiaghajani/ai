// Header actions on the record pages of the knowledge tables (the form agents and managers use): on an article —
// «صفحهٔ مقاله» (the reading view), «ویرایش» / «ادامهٔ پیش‌نویس», «بازبینی شد»; on a version — «ویرایشگر»,
// «مقایسه» with the published version, «بازگرداندن این نسخه» (an old version becomes a new draft); on a known error —
// «مقالهٔ دانش» (creates or opens its known-error article).
import { useNavigate } from "react-router";
import { Button, Tooltip } from "antd";
import { BookOpenText, GitCompare, PencilLine, Play, RotateCcw, ShieldCheck, SquarePen } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import type { RecordContext } from "../../records";
import { kbApi, useKbRefresh } from "./api";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

interface KnowledgeMeta {
  contributor?: boolean;
  draft?: { id: string; state: string; version_label: string | null } | null;
}

export function ArticleRecordActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refresh = useKbRefresh();
  const m = (ctx.meta as { knowledge?: KnowledgeMeta }).knowledge ?? {};
  const state = String(ctx.row.state ?? "");
  const live = state === "published" || state === "pending_retirement";
  const edit = useAction(() => (m.draft ? Promise.resolve({ version: { id: m.draft.id } }) : kbApi.draft(api, ctx.row.id, "minor")), { onSuccess: (d) => nav(`/${orgId}/kb/edit/${d.version.id}`) });
  const reviewed = useAction(() => kbApi.review(api, ctx.row.id, "confirm"), {
    success: "بازبینی ثبت شد",
    onSuccess: () => {
      ctx.refresh();
      void refresh();
    },
  });
  return (
    <>
      <Button icon={<BookOpenText {...I16} />} onClick={() => nav(`/${orgId}/kb/a/${ctx.row.id}`)}>
        صفحهٔ مقاله
      </Button>
      {m.contributor && !["retired", "trashed"].includes(state) ? (
        <Button type="primary" icon={<PencilLine {...I16} />} onClick={() => edit.mutate()} loading={edit.isPending}>
          {m.draft ? "ادامهٔ پیش‌نویس" : "ویرایش"}
        </Button>
      ) : null}
      {m.contributor && live ? (
        <Tooltip title="مقاله هنوز درست است: موعد بازبینی بعدی جلو می‌رود">
          <Button icon={<ShieldCheck {...I16} />} onClick={() => reviewed.mutate()} loading={reviewed.isPending}>
            بازبینی شد
          </Button>
        </Tooltip>
      ) : null}
    </>
  );
}

export function VersionRecordActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const state = String(ctx.row.state ?? "");
  const restore = useAction(() => kbApi.restoreVersion(api, ctx.row.id), { success: "این نسخه پیش‌نویس تازه شد", onSuccess: (d) => nav(`/${orgId}/kb/edit/${d.version.id}`) });
  const article = String(ctx.row.article_id ?? "");
  return (
    <>
      {["draft", "in_review", "scheduled"].includes(state) ? (
        <Button type="primary" icon={<SquarePen {...I16} />} onClick={() => nav(`/${orgId}/kb/edit/${ctx.row.id}`)}>
          ویرایشگر
        </Button>
      ) : null}
      <Button icon={<GitCompare {...I16} />} onClick={() => nav(`/${orgId}/kb/diff?article=${article}&b=${ctx.row.id}`)}>
        مقایسه
      </Button>
      {state === "outdated" && ctx.meta.canWrite !== false ? (
        <Button icon={<RotateCcw {...I16} />} onClick={() => restore.mutate()} loading={restore.isPending}>
          بازگرداندن این نسخه
        </Button>
      ) : null}
    </>
  );
}

export function TreeRecordActions({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  return (
    <Button type="primary" icon={<Play {...I16} />} onClick={() => nav(`/${orgId}/kb/tree/${ctx.row.id}`)}>
      اجرای درخت
    </Button>
  );
}

export function KnownErrorActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const make = useAction(() => kbApi.fromKnownError(api, ctx.row.id), {
    success: (d) => (d.existing ? "مقالهٔ این خطای شناخته‌شده باز شد" : "مقالهٔ خطای شناخته‌شده ساخته شد"),
    onSuccess: (d) => nav(`/${orgId}/kb/a/${d.article.id}`),
  });
  return (
    <Button icon={<BookOpenText {...I16} />} onClick={() => make.mutate()} loading={make.isPending}>
      مقالهٔ دانش
    </Button>
  );
}
