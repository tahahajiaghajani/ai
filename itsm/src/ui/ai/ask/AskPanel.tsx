// <AskPanel>: ask a question over the sources a member may read and get a cited answer (POST /ai/ask/stream). The
// passages arrive first, then the answer is written; «[n]» markers open the cited passage (a document at its page with
// the passage highlighted, or the record). Abstentions, answers without a model (the passages alone) and sentences
// without a source are said plainly; AI-written text is always labelled. Later modules embed it with their own scope
// (a knowledge base, the portal, a record's context): `<AskPanel scope={{ tables: ["kb_article"] }} />`.
import "./ask.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, Input } from "antd";
import { CornerDownLeft, FileText, Sparkles, Square } from "lucide-react";
import type { AiAskResult, AiAskScope, AiPassage, AiRetrieveInfo } from "@shared/ai/rag";
import { NO_ANSWER_FA } from "@shared/ai/rag";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { Chip } from "../../components/display";
import { Markdown } from "../markdown/Markdown";
import { askStream } from "./api";
import { citationHref, citationLabel, linkCitations } from "./model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface AskPanelProps {
  /** where to look (nothing = every source the member may read) */
  scope?: AiAskScope;
  placeholder?: string;
  /** a question to ask right away (e.g. from the command palette) */
  initialQuestion?: string;
  /** shown above the box while nothing was asked yet */
  intro?: ReactNode;
  /** a smaller box for side panels */
  compact?: boolean;
  /** asking is not possible right now (no scope chosen…): the reason */
  disabledReason?: string | null;
}

type Phase = "idle" | "searching" | "writing" | "done" | "error";

export function AskPanel({ scope, placeholder = "پرسش خود را بنویسید…", initialQuestion, intro, compact, disabledReason }: AskPanelProps) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [asked, setAsked] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [passages, setPassages] = useState<AiPassage[]>([]);
  const [info, setInfo] = useState<AiRetrieveInfo | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<AiAskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const ask = async (q: string) => {
    const clean = q.trim();
    if (clean.length < 2 || disabledReason) return;
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    setAsked(clean);
    setPhase("searching");
    setPassages([]);
    setInfo(null);
    setText("");
    setResult(null);
    setError(null);
    try {
      const r = await askStream(
        api,
        { question: clean, scope: scope ?? null },
        {
          onPassages: (p, i) => {
            setPassages(p);
            setInfo(i);
            setPhase("writing");
          },
          onText: (d) => setText((t) => t + d),
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setResult(r);
      setText(r.answer);
      setPhase("done");
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(errorText(e));
      setPhase("error");
    }
  };

  useEffect(() => {
    if (initialQuestion?.trim()) void ask(initialQuestion);
    return () => ctl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const stop = () => {
    ctl.current?.abort();
    setPhase(text ? "done" : "idle");
  };

  const busy = phase === "searching" || phase === "writing";
  const citations = result?.citations ?? passages.map((p) => p.citation);
  const open = (path: string) => navigate(`/${orgId}/${path}`);

  return (
    <div className={`ask ${compact ? "is-compact" : ""}`}>
      <div className="ask-box">
        <Input.TextArea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          autoSize={{ minRows: compact ? 1 : 2, maxRows: 6 }}
          placeholder={placeholder}
          maxLength={2000}
          aria-label="پرسش"
          disabled={!!disabledReason}
        />
        {busy ? (
          <Button icon={<Square {...ICON} />} onClick={stop} aria-label="توقف">
            توقف
          </Button>
        ) : (
          <Button type="primary" icon={<CornerDownLeft {...ICON} />} onClick={() => void ask(question)} disabled={question.trim().length < 2 || !!disabledReason}>
            بپرس
          </Button>
        )}
      </div>
      {disabledReason ? <div className="ask-hint">{disabledReason}</div> : null}

      {phase === "idle" && intro ? <div className="ask-intro">{intro}</div> : null}

      {phase !== "idle" ? (
        <section className="ask-answer" aria-live="polite" aria-busy={busy}>
          <header className="ask-answer-h">
            <Sparkles {...ICON} aria-hidden />
            <span className="ask-q">{asked}</span>
            {info?.quality === "local" ? <Chip tone="neutral" title="مدل بردارسازی تنظیم نشده یا در دسترس نیست؛ جست‌وجو با واژه‌ها و بردارساز داخلی انجام شد">جست‌وجوی پایه</Chip> : null}
          </header>
          {phase === "searching" ? <div className="ask-wait">در حال جست‌وجو در منابعی که به آن‌ها دسترسی دارید…</div> : null}
          {phase === "error" ? <div className="ask-error" role="alert">{error}</div> : null}
          {text ? (
            <div className="ask-text">
              <Markdown
                text={linkCitations(text, citations)}
                streaming={phase === "writing"}
                resolve={(href) => citationHref(href, citations)}
                hrefOf={(p) => `/${orgId}/${p}`}
                onNavigate={open}
              />
              <div className="ask-label">{result?.synthesized === false ? "بخش‌های مرتبط، بدون جمع‌بندی هوش مصنوعی" : "نوشتهٔ هوش مصنوعی از منابع شما؛ پیش از استفاده بررسی کنید"}</div>
            </div>
          ) : null}
          {result?.note && result.synthesized === false ? <div className="ask-note">{result.note.split("؛")[0]}</div> : null}
          {result && !result.abstained && result.unsupported.length ? (
            <div className="ask-unsupported">
              <Chip tone="warning">بدون منبع</Chip>
              <ul>
                {result.unsupported.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(result ? result.citations.length : passages.length) && !(result?.abstained && result.answer === NO_ANSWER_FA) ? (
            <ol className="ask-sources" aria-label="منابع">
              {(result ? result.citations : passages.map((p) => p.citation)).map((c) => {
                const p = (result?.passages ?? passages).find((x) => x.n === c.n);
                return (
                  <li key={`${c.n}-${c.chunk_id}`}>
                    <button type="button" className="ask-src" onClick={() => open(c.path)}>
                      <span className="ask-src-n ds-num">{c.n}</span>
                      <span className="ask-src-b">
                        <span className="ask-src-t">
                          {c.table === "doc_document" ? <FileText size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden /> : null}
                          {c.title}
                        </span>
                        <span className="ask-src-m">{citationLabel(c)}</span>
                        {p ? <span className="ask-src-x">{p.text.replace(/\s+/g, " ").slice(0, 220)}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
