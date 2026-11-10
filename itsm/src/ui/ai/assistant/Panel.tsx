// «دستیار» (the assistant) — the panel. Docked at the end edge of wide screens (resizable; the page makes room), floating over
// the page on mid-size screens and a full-screen sheet on phones. The conversation lives in the store (store.ts), so
// an answer keeps streaming while the panel is closed or the page changes.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Tooltip } from "antd";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileText,
  CalendarDays,
  KeyRound,
  Power,
  ScanSearch,
  SquarePen,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME } from "@shared/constants";
import { D } from "@shared/money";
import type { AiStatus } from "@shared/ai/api";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Ic, Keys, AiIcon } from "../../components/shell/icons";
import { useRelPath, useShellItems } from "../../components/shell/model";
import { resolveHref } from "../markdown/links";
import { openAssistant } from "./bus";
import { pageContext, titleOf } from "./context";
import { Composer, type ComposerHandle } from "./Composer";
import { Message, type MessageEnv } from "./Message";
import { promptName, readOwnPrompts, suggestionsFor, writeOwnPrompts, type PromptIcon, type Suggestion } from "./prompts";
import { storeFor, useAssistantState } from "./store";
import { knownRefs } from "./state";
import { toInput, type PendingFile } from "./attach";
import { isOff, useAiClient, useAiStatus, useThreads } from "./useAi";
import { Threads } from "./Threads";
import type { PendingRequest } from "./AssistantHost";
import "./assistant.css";

const ICONS: Record<PromptIcon, LucideIcon> = {
  summary: FileText,
  chart: ChartColumn,
  people: Users,
  calendar: CalendarDays,
  doc: FileText,
  search: ScanSearch,
  forecast: TrendingUp,
  draft: FilePen,
};

// ---------------------------------------------------------------- layout: dock, float, sheet

type Mode = "dock" | "float" | "sheet";
const W_KEY = "itsm.ai.w";
const W_MIN = 360;
const W_DEFAULT = 420;
const W_MAX = 720;

function useMode(): Mode {
  const get = (): Mode => (window.innerWidth < 768 ? "sheet" : window.innerWidth < 1100 ? "float" : "dock");
  const [mode, setMode] = useState<Mode>(get);
  useEffect(() => {
    const on = () => setMode(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return mode;
}

const clampW = (w: number) => Math.round(Math.min(Math.min(W_MAX, window.innerWidth * 0.5), Math.max(W_MIN, w)));

function readW(): number {
  try {
    const v = Number(localStorage.getItem(W_KEY));
    return v ? clampW(v) : W_DEFAULT;
  } catch {
    return W_DEFAULT;
  }
}

function writeW(w: number) {
  try {
    localStorage.setItem(W_KEY, String(w));
  } catch {
    /* blocked storage: the width resets after a reload */
  }
}

/** The handle on the panel's inner edge: drag, arrow keys, double-click resets. */
function Resizer({ width, onWidth }: { width: number; onWidth: (w: number, commit: boolean) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const rtl = document.documentElement.dir !== "ltr";
  return (
    <div
      className="sa-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="پهنای دستیار"
      aria-valuemin={W_MIN}
      aria-valuemax={W_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.documentElement.classList.add("sa-resizing");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // the panel sits at the end edge: in RTL (left side) it grows as the pointer moves right
        const delta = rtl ? e.clientX - d.x : d.x - e.clientX;
        onWidth(clampW(d.w + delta), false);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const d = drag.current;
        drag.current = null;
        document.documentElement.classList.remove("sa-resizing");
        onWidth(clampW(d.w + (rtl ? e.clientX - d.x : d.x - e.clientX)), true);
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.documentElement.classList.remove("sa-resizing");
      }}
      onDoubleClick={() => onWidth(clampW(W_DEFAULT), true)}
      onKeyDown={(e) => {
        const grow = rtl ? "ArrowRight" : "ArrowLeft";
        const shrink = rtl ? "ArrowLeft" : "ArrowRight";
        if (e.key === grow || e.key === shrink) {
          e.preventDefault();
          onWidth(clampW(width + (e.key === grow ? 24 : -24)), true);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------- the page the question is about

function usePageContext() {
  const rel = useRelPath();
  const { search } = useLocation();
  const [title, setTitle] = useState<string | null>(() => titleOf(document.title, APP_NAME));
  // AppShell sets the window title after the page renders: follow it
  useEffect(() => {
    const read = () => setTitle(titleOf(document.title, APP_NAME));
    read();
    const el = document.querySelector("title");
    const mo = el ? new MutationObserver(read) : null;
    if (el && mo) mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => mo?.disconnect();
  }, []);
  const [dropped, setDropped] = useState<string | null>(null);
  const ctx = useMemo(() => pageContext(rel, search, title), [rel, search, title]);
  const key = `${rel}?${search}`;
  return { ctx, rel, off: dropped === key, drop: () => setDropped(key) };
}

// ---------------------------------------------------------------- states before the conversation

function Hello({ icon, title, text, children, tone }: { icon: LucideIcon; title: string; text?: string; children?: React.ReactNode; tone?: "accent" | "quiet" }) {
  return (
    <div className="sa-hello ds-enter">
      <span className={`sa-hello-mark ${tone === "quiet" ? "is-quiet" : ""}`} aria-hidden>
        <Ic icon={icon} size={22} />
      </span>
      <h2 className="sa-hello-t">{title}</h2>
      {text ? <p className="sa-hello-p">{text}</p> : null}
      {children}
    </div>
  );
}

function Suggestions({ list, onPick }: { list: Suggestion[]; onPick: (s: Suggestion) => void }) {
  if (!list.length) return null;
  return (
    <div className="sa-sugg ds-stagger" role="list" aria-label="پیشنهادها">
      {list.map((s) => (
        <button key={s.key} type="button" role="listitem" className="sa-sugg-r ds-press" onClick={() => onPick(s)}>
          <Ic icon={ICONS[s.icon] ?? AiIcon} />
          <span>{s.fill ? `${s.text}…` : s.text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * With no model (AI off or not set up), the panel offers what the command palette does without one: its actions
 * («کارها» — a new incident, an order from the catalogue…) for this member, deterministic and permission-filtered.
 */
function PaletteActions({ items, onGo }: { items: { key: string; label: string; path: string; icon?: LucideIcon; action?: boolean }[]; onGo: (path: string) => void }) {
  const actions = items.filter((i) => i.action && i.path).slice(0, 8);
  if (!actions.length) return null;
  return (
    <div className="sa-sugg" role="list" aria-label="کارهای بی‌نیاز به هوش مصنوعی">
      {actions.map((i) => (
        <button key={i.key} type="button" role="listitem" className="sa-sugg-r ds-press" onClick={() => onGo(i.path)}>
          <Ic icon={i.icon ?? AiIcon} />
          <span>{i.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The person's own daily cap (not the organisation's monthly one) stopped the assistant. */
function dailyCapHit(b: AiStatus["budget"]): boolean {
  if (!b.today_cap_usd) return false;
  try {
    return D(b.today_usd).gte(D(b.today_cap_usd));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- panel

export default function Panel({ open, onClose, pending }: { open: boolean; onClose: () => void; pending: PendingRequest | null }) {
  const { orgId, has, can } = useOrg();
  const client = useAiClient();
  const store = useMemo(() => storeFor(orgId, client), [orgId, client]);
  const snap = useAssistantState(store);
  const status = useAiStatus();
  const s = status.data;
  const qc = useQueryClient();
  const n = useNotify();
  const nav = useNavigate();
  const items = useShellItems();
  const mode = useMode();
  const [width, setWidth] = useState(readW);
  const [view, setView] = useState<"chat" | "threads">("chat");
  const [promptsVersion, setPromptsVersion] = useState(0);
  const { ctx, rel, off, drop } = usePageContext();
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  const threads = useThreads(open && !!snap.threadId);
  const thread = threads.data?.find((t) => t.id === snap.threadId);
  const firstQuestion = snap.messages.find((m) => m.role === "user")?.text;
  const threadTitle = thread?.title || (firstQuestion ? firstQuestion.slice(0, 60) : null);

  // what the panel can do now
  const off_ = isOff(s);
  const notConfigured = !!s && !off_ && !s.configured;
  const budgetStopped = s?.budget?.state === "stopped";
  const canManage = s?.can_manage ?? can("ai", "full");
  const canDraft = s?.can_propose ?? can("ai", "edit");
  const blocked = !s || off_ || notConfigured || budgetStopped;
  const busy = store.busy;

  // ---------------------------------------------------------------- frame: dock width, root attribute
  useEffect(() => {
    const root = document.documentElement;
    if (open && mode !== "sheet") root.dataset.aiDock = mode;
    else delete root.dataset.aiDock;
    if (open && mode === "sheet") root.classList.add("sa-sheet-open");
    else root.classList.remove("sa-sheet-open");
    return () => {
      delete root.dataset.aiDock;
      root.classList.remove("sa-sheet-open");
    };
  }, [open, mode]);
  useEffect(() => {
    document.documentElement.style.setProperty("--ai-dock-w", `${width}px`);
  }, [width]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--ai-dock-w");
    },
    [],
  );

  const onWidth = useCallback((w: number, commit: boolean) => {
    document.documentElement.style.setProperty("--ai-dock-w", `${w}px`);
    if (commit) {
      setWidth(w);
      writeW(w);
    }
  }, []);

  // focus the question box when the panel opens
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => composer.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  // the conversation list refreshes when an answer ends; a closed panel says the answer is ready
  useEffect(() => {
    store.onSettled = (threadId, ok) => {
      void qc.invalidateQueries({ queryKey: ["ai", orgId, "threads"] });
      void qc.invalidateQueries({ queryKey: ["ai", orgId, "status"] });
      if (!openRef.current && ok && threadId)
        n.ok("پاسخ دستیار آماده است", { action: { label: "دیدن پاسخ", onClick: () => openAssistant() } });
    };
    return () => {
      store.onSettled = null;
    };
  }, [store, qc, orgId, n]);

  // ---------------------------------------------------------------- scrolling: follow the answer while at the bottom
  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useEffect(() => {
    if (stick.current) toBottom();
  }, [snap.messages, toBottom]);
  // charts and tables fill in after their rows load: keep the end in view while following
  useEffect(() => {
    const el = scroller.current?.firstElementChild;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, snap.messages.length > 0, toBottom]);
  useEffect(() => {
    stick.current = true;
    setAway(false);
    requestAnimationFrame(() => toBottom());
  }, [snap.threadId, view, open, toBottom]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    stick.current = near;
    if (away === near) setAway(!near);
  };

  // ---------------------------------------------------------------- asking
  const contextFor = () => (off ? null : ctx);

  const ask = useCallback(
    (text: string, files: PendingFile[] = []) => {
      if (blocked || busy) return false;
      stick.current = true;
      setView("chat");
      void store.send(text || "این پیوست را بررسی کن.", files.map(toInput), off ? null : ctx);
      return true;
    },
    [blocked, busy, store, off, ctx],
  );

  const pickSuggestion = (sg: Suggestion) => {
    if (sg.fill) composer.current?.setText(sg.text);
    else ask(sg.text);
  };

  // openAssistant() requests: a new conversation, a stored one, a question to send or to prefill
  const handled = useRef(0);
  useEffect(() => {
    if (!pending || pending.seq === handled.current) return;
    if (s === undefined && status.isLoading) return; // wait for the status (a question may need it)
    handled.current = pending.seq;
    const r = pending.req;
    if (r.fresh) store.reset();
    if (r.threadId) void store.open(r.threadId);
    setView("chat");
    if (r.prompt) {
      if (r.send === false || blocked || store.busy) composer.current?.setText(r.prompt);
      else void store.send(r.prompt, [], r.context ?? contextFor());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, s, status.isLoading]);

  // ---------------------------------------------------------------- message environment
  const pages = useMemo(() => new Set(items.map((i) => i.path).filter(Boolean)), [items]);
  const refs = useMemo(() => knownRefs(snap.messages), [snap.messages]);
  const navigate = useCallback(
    (path: string, state?: unknown) => {
      nav(`/${orgId}/${path.replace(/^\/+/, "")}`, state ? { state } : undefined);
      if (mode === "sheet") onClose();
    },
    [nav, orgId, mode, onClose],
  );
  const env = useMemo<MessageEnv>(
    () => ({
      phase: snap.phase,
      canManage,
      resolve: (href) => resolveHref(href, refs, pages),
      hrefOf: (path) => `/${orgId}/${path}`,
      navigate,
      copy: (text) => {
        navigator.clipboard?.writeText(text).then(
          () => n.note("رونوشت شد."),
          () => n.warn("رونوشت برداشته نشد؛ متن را انتخاب و رونوشت کنید."),
        );
      },
      rate: (key, rating) => {
        store.rate(key, rating).catch((e) => n.error(e));
      },
      retry: () => void store.retry(),
      resume: () => void store.resume(),
      savePrompt: (text) => {
        const own = readOwnPrompts(orgId);
        if (own.some((p) => p.text === text)) {
          n.note("این پرسش در دستورهای آماده هست.");
          return;
        }
        writeOwnPrompts(orgId, [{ key: `own-${Date.now().toString(36)}`, name: promptName(text), text, own: true }, ...own].slice(0, 30));
        setPromptsVersion((v) => v + 1);
        n.note("به دستورهای آماده افزوده شد؛ با «/» در دسترس است.");
      },
      setProposal: (p) => store.setProposal(p),
      openSettings: () => navigate("settings/ai"),
    }),
    [snap.phase, canManage, refs, pages, orgId, navigate, n, store],
  );

  // ---------------------------------------------------------------- keys and drops
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest(".ant-dropdown, .ant-select-dropdown, .ant-modal")) return;
    e.preventDefault();
    if (view === "threads") setView("chat");
    else onClose();
  };
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    setDragOver(false);
    if (!blocked) composer.current?.addFiles(Array.from(e.dataTransfer.files));
  };

  // ---------------------------------------------------------------- body
  const suggestions = useMemo(() => suggestionsFor(rel, { has, canDraft, recordType: ctx.record?.type ?? null }, 4), [rel, has, canDraft, ctx.record?.type]);
  const settingsButton = (label: string) => (
    <Button type="primary" onClick={() => navigate("settings/ai")}>
      {label}
    </Button>
  );

  let body: React.ReactNode;
  if (view === "threads") {
    body = (
      <Threads
        activeId={snap.threadId}
        onOpen={(id) => {
          setView("chat");
          void store.open(id);
        }}
        onDeleted={(id) => store.forget(id)}
      />
    );
  } else if (!s && status.isLoading) {
    body = (
      <div className="sa-card-skel sa-pad" aria-busy="true" aria-label="در حال بارگذاری">
        {[64, 82, 48].map((w, i) => (
          <i key={i} className="ds-skel" style={{ inlineSize: `${w}%` }} />
        ))}
      </div>
    );
  } else if (!s) {
    body = (
      <Hello icon={CircleAlert} tone="quiet" title="وضعیت دستیار خوانده نشد" text="اتصال را بررسی کنید و دوباره تلاش کنید.">
        <Button onClick={() => void status.refetch()}>تلاش دوباره</Button>
      </Hello>
    );
  } else if (off_) {
    body = (
      <Hello icon={Power} tone="quiet" title="دستیار خاموش است" text={s.message_fa ?? (canManage ? "دستیار را در تنظیمات هوش مصنوعی روشن کنید." : "از مدیر سازمان بخواهید دستیار را روشن کند.")}>
        {canManage && s.kind !== "disabled" ? settingsButton("تنظیمات هوش مصنوعی") : null}
        <PaletteActions items={items} onGo={(p) => navigate(p)} />
      </Hello>
    );
  } else if (notConfigured && !snap.messages.length) {
    body = (
      <Hello
        icon={KeyRound}
        title="هوش مصنوعی هنوز راه‌اندازی نشده است"
        text={canManage ? "کلید یکی از سرویس‌های هوش مصنوعی را در تنظیمات وارد کنید تا دستیار با داده‌های همین سازمان پاسخ دهد." : "از مدیر سازمان بخواهید هوش مصنوعی را راه‌اندازی کند."}
      >
        {canManage ? settingsButton("راه‌اندازی هوش مصنوعی") : null}
        <PaletteActions items={items} onGo={(p) => navigate(p)} />
      </Hello>
    );
  } else if (snap.phase === "loading") {
    body = (
      <div className="sa-card-skel sa-pad" aria-busy="true" aria-label="در حال بارگذاری گفت‌وگو">
        {[40, 86, 72, 58, 80].map((w, i) => (
          <i key={i} className="ds-skel" style={{ inlineSize: `${w}%` }} />
        ))}
      </div>
    );
  } else if (snap.loadError) {
    body = (
      <Hello icon={CircleAlert} tone="quiet" title="گفت‌وگو خوانده نشد" text={snap.loadError}>
        <Button onClick={() => snap.threadId && void store.open(snap.threadId)}>تلاش دوباره</Button>
      </Hello>
    );
  } else if (!snap.messages.length) {
    body = (
      <Hello icon={AiIcon} title="از داده‌های سازمان بپرسید" text="پاسخ‌ها از دفترهای همین سازمان ساخته می‌شود و هر ثبتی پیش از انجام، تأیید شما را می‌خواهد.">
        <Suggestions list={suggestions} onPick={pickSuggestion} />
      </Hello>
    );
  } else {
    body = (
      <div className="sa-msgs" aria-live="polite" aria-relevant="additions">
        {snap.messages.map((m, i) => (
          <Message key={m.key} m={m} last={i === snap.messages.length - 1} env={env} />
        ))}
      </div>
    );
  }

  const notice =
    s && !off_ && !notConfigured ? (
      budgetStopped ? (
        <div className="sa-notice is-danger" role="status">
          <Ic icon={CircleAlert} />
          <span>{dailyCapHit(s.budget) ? "سقف هزینهٔ امروز شما پر شده است؛ تا فردا دستیار پاسخ نمی‌دهد." : "سقف هزینهٔ هوش مصنوعی این ماه پر شده است؛ تا ماه بعد دستیار پاسخ نمی‌دهد."}</span>
          {canManage ? (
            <button type="button" className="sa-mini" onClick={() => navigate("settings/ai")}>
              بودجه
            </button>
          ) : null}
        </div>
      ) : !s.ok && s.message_fa ? (
        <div className="sa-notice" role="status">
          <Ic icon={CircleAlert} />
          <span>
            {s.message_fa}
            {s.remedy_fa ? ` ${s.remedy_fa}` : ""}
          </span>
          {canManage ? (
            <button type="button" className="sa-mini" onClick={() => navigate("settings/ai")}>
              تنظیمات
            </button>
          ) : null}
        </div>
      ) : null
    ) : null;

  const showComposer = view === "chat" && !!s && !off_ && !(notConfigured && !snap.messages.length);
  const chip = !off && ctx.title ? { title: ctx.title } : null;

  return (
    <aside
      className={`sa-panel is-${mode} ${dragOver ? "is-drop" : ""}`}
      data-open={open}
      aria-label={`دستیار ${APP_NAME}`}
      aria-hidden={!open}
      inert={!open}
      style={{ ["--sa-w" as string]: `${width}px` } as CSSProperties}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {mode === "dock" ? <Resizer width={width} onWidth={onWidth} /> : null}
      <header className="sa-h">
        {view === "threads" ? (
          <>
            <Tooltip title="بازگشت به گفت‌وگو" mouseEnterDelay={0.4}>
              <button type="button" className="sh-icon-btn" aria-label="بازگشت به گفت‌وگو" onClick={() => setView("chat")}>
                <Ic icon={ChevronRight} />
              </button>
            </Tooltip>
            <span className="sa-h-name">گفت‌وگوها</span>
          </>
        ) : (
          <button type="button" className="sa-h-t" aria-label="گفت‌وگوها" aria-expanded={false} onClick={() => setView("threads")}>
            <span className="sa-h-mark" aria-hidden>
              <Ic icon={AiIcon} />
            </span>
            <span className="sa-h-tt">
              <span className="sa-h-name">دستیار {APP_NAME}</span>
              {threadTitle ? (
                <span className="sa-h-sub" dir="auto">
                  {threadTitle}
                </span>
              ) : null}
            </span>
            <Ic icon={ChevronDown} size={14} className="sa-h-chev" />
          </button>
        )}
        <span className="ds-end sa-h-x">
          {view === "chat" && s && !off_ && !notConfigured ? (
            <Tooltip title="گفت‌وگوی تازه" mouseEnterDelay={0.4}>
              <button
                type="button"
                className="sh-icon-btn"
                aria-label="گفت‌وگوی تازه"
                disabled={!snap.messages.length && !snap.threadId}
                onClick={() => {
                  store.reset();
                  composer.current?.focus();
                }}
              >
                <Ic icon={SquarePen} />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip
            title={
              <span className="sa-tip-keys">
                بستن <Keys keys={["Ctrl", "J"]} className="sh-keys-tip" />
              </span>
            }
            mouseEnterDelay={0.4}
          >
            <button type="button" className="sh-icon-btn" aria-label="بستن دستیار" onClick={onClose}>
              <Ic icon={X} />
            </button>
          </Tooltip>
        </span>
      </header>
      <div className="sa-body" ref={scroller} onScroll={onScroll}>
        {body}
      </div>
      {away && view === "chat" && snap.messages.length ? (
        <button
          type="button"
          className="sa-jump ds-pop"
          aria-label="رفتن به آخرین پیام"
          onClick={() => {
            stick.current = true;
            setAway(false);
            toBottom(true);
          }}
        >
          <Ic icon={ArrowDown} />
        </button>
      ) : null}
      {showComposer ? (
        <footer className="sa-foot">
          {notice}
          <Composer
            handle={composer}
            orgId={orgId}
            has={has}
            disabled={blocked || snap.phase === "loading" || snap.phase === "elsewhere"}
            busy={busy}
            onSend={(text, files) => ask(text, files)}
            onStop={() => store.stop()}
            context={chip}
            onDropContext={drop}
            model={s?.model ?? null}
            promptsVersion={promptsVersion}
          />
          <div className="sa-foot-note">دستیار ممکن است اشتباه کند؛ عددها را با منابع بسنجید.</div>
        </footer>
      ) : null}
      {dragOver ? (
        <div className="sa-dropzone" aria-hidden>
          عکس یا PDF را اینجا رها کنید
        </div>
      ) : null}
    </aside>
  );
}
