// One message of the conversation. A question is a quiet bubble at the end side; an answer reads like a page:
// the steps the assistant took (tools), its reasoning (on request), the text, charts and tables from the tools'
// rows, drafts waiting for confirmation, the records it used («منابع»), then copy and rating.
import { memo, useState, type ReactNode } from "react";
import { Tooltip } from "antd";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ThumbsUp,
  ThumbsDown,
  BookmarkPlus,
  Receipt,
  FileText,
  User,
  Package,
  Gem,
  ArrowLeftRight,
  Wallet,
  BookOpenText,
  ChartColumn,
  Link2,
  RotateCcw,
  Play,
  Settings2,
  Paperclip,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import type { AiErrorKind, AiProposal, AiRef } from "@shared/ai/types";
import { fa } from "../../lib/fa";
import { Loader } from "../../components/display";
import { ChequeIcon, Ic } from "../../components/shell/icons";
import { Markdown } from "../markdown/Markdown";
import { refPath } from "../markdown/links";
import { ChartCard, TableCard } from "./DataViews";
import { ProposalCard } from "./ProposalCard";
import type { Phase } from "./store";
import type { UiMessage, UiTool } from "./state";

const REF_ICON: Record<string, LucideIcon> = {
  invoice: Receipt,
  voucher: FileText,
  party: User,
  item: Package,
  gold_doc: Gem,
  gold_bar: Gem,
  coin: Gem,
  fx_deal: ArrowLeftRight,
  remittance: ArrowLeftRight,
  cheque: ChequeIcon,
  treasury_doc: Wallet,
  account: BookOpenText,
  report: ChartColumn,
};

/** Errors only someone who manages AI can fix (keys, budget, switches). */
const ADMIN_KINDS = new Set<AiErrorKind>(["not_configured", "disabled", "auth", "region", "quota", "model", "budget"]);
const NO_RETRY = new Set<AiErrorKind>(["refusal", ...ADMIN_KINDS]);

export interface MessageEnv {
  phase: Phase;
  canManage: boolean;
  /** a link target in an answer → in-app path, or null */
  resolve: (href: string) => string | null;
  hrefOf: (path: string) => string;
  navigate: (path: string, state?: unknown) => void;
  copy: (text: string) => void;
  rate: (key: string, rating: 1 | -1 | null) => void;
  retry: () => void;
  resume: () => void;
  savePrompt: (text: string) => void;
  setProposal: (p: AiProposal) => void;
  openSettings: () => void;
}

function Act({ label, icon, onClick, pressed }: { label: string; icon: LucideIcon; onClick: () => void; pressed?: boolean }) {
  return (
    <Tooltip title={label} mouseEnterDelay={0.4}>
      <button type="button" className="sa-act" aria-label={label} aria-pressed={pressed} onClick={onClick}>
        <Ic icon={icon} size={15} />
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- the question

function UserMessage({ m, env }: { m: UiMessage; env: MessageEnv }) {
  return (
    <div className="sa-msg sa-msg-u">
      {m.context?.title ? (
        <div className="sa-msg-ctx">
          <Ic icon={MapPin} size={13} />
          <span>{m.context.title}</span>
        </div>
      ) : null}
      {m.text ? (
        <div className="sa-bubble" dir="auto">
          {m.text}
        </div>
      ) : null}
      {m.attachments.length ? (
        <div className="sa-msg-files">
          {m.attachments.map((a, i) => (
            <span key={i} className="sa-file is-sent">
              <Ic icon={Paperclip} size={13} />
              <span className="sa-file-n">{a.name}</span>
            </span>
          ))}
        </div>
      ) : null}
      {m.text ? (
        <div className="sa-acts">
          <Act label="رونوشت" icon={Copy} onClick={() => env.copy(m.text)} />
          <Act label="ذخیره در دستورهای آماده" icon={BookmarkPlus} onClick={() => env.savePrompt(m.text)} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- steps and reasoning

function ToolSteps({ tools, live }: { tools: UiTool[]; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? live;
  const failed = tools.filter((t) => t.status === "failed").length;
  const running = tools.some((t) => t.status === "running");
  const head = running ? "در حال بررسی" : `${fa(tools.length)} مرحلهٔ بررسی${failed ? `، ${fa(failed)} ناموفق` : ""}`;
  return (
    <div className="sa-steps">
      <button type="button" className="sa-steps-h" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <span>{head}</span>
        <Ic icon={ChevronDown} size={14} className={expanded ? "is-up" : undefined} />
      </button>
      {expanded ? (
        <ol className="sa-steps-l">
          {tools.map((t) => (
            <li key={t.call_id} className={`sa-step is-${t.status}`}>
              <span className="sa-step-ic" aria-hidden>
                {t.status === "running" ? <Loader label="" /> : t.status === "ok" ? <Ic icon={Check} size={14} /> : <Ic icon={CircleAlert} size={14} />}
              </span>
              <span className="sa-step-t">
                {t.title_fa || t.tool}
                {t.input_fa ? <span className="sa-step-in">{t.input_fa}</span> : null}
              </span>
              {t.summary_fa ? <span className="sa-step-s">{t.summary_fa}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sa-reason">
      <button type="button" className="sa-steps-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>روند فکر</span>
        <Ic icon={ChevronDown} size={14} className={open ? "is-up" : undefined} />
      </button>
      {open ? (
        <div className="sa-reason-t" dir="auto">
          {text}
        </div>
      ) : null}
    </div>
  );
}

function Thinking({ phase, label }: { phase: Phase; label?: string }) {
  const text =
    phase === "reconnecting" ? "اتصال قطع شد؛ در حال وصل دوباره" : phase === "continuing" ? "کار ادامه دارد" : phase === "elsewhere" ? "پاسخ در حال آماده شدن است" : (label ?? "در حال فکر کردن");
  return (
    <div className="sa-think" role="status">
      <Loader label={text} />
      <span>{text}…</span>
    </div>
  );
}

// ---------------------------------------------------------------- sources, notes, actions

function Sources({ refs, env }: { refs: AiRef[]; env: MessageEnv }) {
  const items = refs.map((r) => ({ r, path: refPath(r) })).filter((x) => x.path);
  if (!items.length) return null;
  return (
    <div className="sa-src" aria-label="منابع">
      <span className="sa-src-l">منابع</span>
      {items.slice(0, 12).map(({ r, path }) => (
        <a
          key={`${r.type}:${r.id}`}
          className="sa-ref"
          href={env.hrefOf(path!)}
          title={r.label}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            env.navigate(path!);
          }}
        >
          <Ic icon={REF_ICON[r.type] ?? Link2} size={14} />
          <span>{r.label}</span>
        </a>
      ))}
    </div>
  );
}

function Note({ tone, icon, children, action }: { tone: "danger" | "quiet"; icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`sa-note is-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Ic icon={icon} />
      <div className="sa-note-t">{children}</div>
      {action ? <div className="sa-note-a">{action}</div> : null}
    </div>
  );
}

function ErrorNote({ m, env }: { m: UiMessage; env: MessageEnv }) {
  const kind = m.error?.kind ?? "other";
  const text = m.error?.message_fa || "پاسخ آماده نشد.";
  let action: ReactNode = null;
  let extra: ReactNode = null;
  if (ADMIN_KINDS.has(kind)) {
    if (env.canManage)
      action = (
        <button type="button" className="sa-mini" onClick={env.openSettings}>
          <Ic icon={Settings2} size={14} />
          تنظیمات هوش مصنوعی
        </button>
      );
    else extra = <div className="sa-note-x">{kind === "not_configured" ? "از مدیر کسب‌وکار بخواهید هوش مصنوعی را راه‌اندازی کند." : "موضوع را با مدیر کسب‌وکار در میان بگذارید."}</div>;
  } else if (!NO_RETRY.has(kind))
    action = (
      <button type="button" className="sa-mini" onClick={env.retry}>
        <Ic icon={RotateCcw} size={14} />
        تلاش دوباره
      </button>
    );
  return (
    <Note tone="danger" icon={CircleAlert} action={action}>
      {text}
      {extra}
    </Note>
  );
}

// ---------------------------------------------------------------- the answer

function AssistantMessage({ m, last, env }: { m: UiMessage; last: boolean; env: MessageEnv }) {
  const live = m.status === "pending" || m.status === "streaming";
  const running = m.tools.some((t) => t.status === "running");
  const waiting = live && !m.text && !running;
  const ended = !live;
  return (
    <article className={`sa-msg sa-msg-a ${live ? "is-live" : ""}`} aria-busy={live}>
      {m.tools.length ? <ToolSteps tools={m.tools} live={live} /> : null}
      {m.thinking && !live ? <Reasoning text={m.thinking} /> : null}
      {waiting ? <Thinking phase={last ? env.phase : "streaming"} label={m.tools.length ? "در حال آماده کردن پاسخ" : undefined} /> : null}
      {m.text ? (
        <div dir="auto">
          <Markdown text={m.text} streaming={live} resolve={env.resolve} hrefOf={env.hrefOf} onNavigate={env.navigate} />
        </div>
      ) : null}
      {m.charts.map((c) => (
        <ChartCard key={`c-${c.data_ref}-${c.spec.kind}`} dataRef={c.data_ref} spec={c.spec} />
      ))}
      {m.tables.map((t) => (
        <TableCard key={`t-${t.data_ref}`} table={t} />
      ))}
      {m.proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} onChange={env.setProposal} onNavigate={env.navigate} />
      ))}
      {m.status === "error" ? <ErrorNote m={m} env={env} /> : null}
      {m.status === "refusal" ? (
        <Note tone="quiet" icon={CircleAlert}>
          دستیار به این درخواست پاسخ نداد.
        </Note>
      ) : null}
      {(m.status === "stopped" || m.status === "max_steps") && last ? (
        <Note
          tone="quiet"
          icon={m.status === "stopped" ? CircleAlert : Play}
          action={
            <button type="button" className="sa-mini" onClick={env.resume}>
              <Ic icon={Play} size={14} />
              ادامه بده
            </button>
          }
        >
          {m.status === "stopped" ? "پاسخ نیمه‌کاره متوقف شد." : "کار طولانی شد و دستیار مکث کرد."}
        </Note>
      ) : null}
      {ended && m.refs.length ? <Sources refs={m.refs} env={env} /> : null}
      {ended && m.text && m.status !== "error" ? (
        <div className="sa-acts sa-acts-a">
          <Act label="رونوشت" icon={Copy} onClick={() => env.copy(m.text)} />
          {m.id ? (
            <>
              <Act label="پاسخ مفید بود" icon={ThumbsUp} pressed={m.rating === 1} onClick={() => env.rate(m.key, m.rating === 1 ? null : 1)} />
              <Act label="پاسخ مفید نبود" icon={ThumbsDown} pressed={m.rating === -1} onClick={() => env.rate(m.key, m.rating === -1 ? null : -1)} />
            </>
          ) : null}
          {m.model ? (
            <span className="sf-end">
              <bdi dir="ltr" className="sa-model">
                {m.model}
              </bdi>
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export const Message = memo(function Message({ m, last, env }: { m: UiMessage; last: boolean; env: MessageEnv }) {
  return m.role === "user" ? <UserMessage m={m} env={env} /> : <AssistantMessage m={m} last={last} env={env} />;
});
