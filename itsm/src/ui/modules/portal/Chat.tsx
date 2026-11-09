// The virtual agent in the portal (PTL-024…028): a conversation with the organisation's assistant on the same brain the
// messengers use (`virtualAgentClient`, every step with the person's own access) — answers written from the knowledge
// they may read with numbered sources, the status of their own tickets, ordering with one question at a time and a
// confirmation before anything is created, reporting an issue, and handing the conversation to a person at any time.
// Cards render as buttons and links; quick replies sit under the last answer; the answer streams as it is written.
// It says plainly that it is an automated assistant. `embed`: the website widget's window (no list, full height).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Tooltip } from "antd";
import { Bot, Check, FileText, Headset, MessageCirclePlus, Send, X } from "lucide-react";
import type { VaCard, VaInput, VaLink, VaMessageView, VaReply, VaState } from "@shared/ai/va";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { RecordMarkdown } from "../../records";
import { virtualAgentClient } from "../../ai/va/api";
import { PORTAL_KEYS, type PortalConfig } from "./api";
import { ago, appPath, portalPath, ticketPath } from "./model";
import { portalItemTableKeys } from "./tables";
import { I16, I20 } from "./parts";

type Msg = VaMessageView & { pending?: boolean; model?: string | null };

const STARTERS = ["وضعیت درخواست‌های من", "گزارش مشکل", "سفارش از کاتالوگ", "گفتگو با کارشناس"];
const CHANNEL_LABEL: Record<string, string> = { portal: "درگاه", app: "برنامه", email: "ایمیل", messenger: "پیام‌رسان", sms: "پیامک", test: "آزمایش" };
const STATE_LABEL: Record<VaState, string> = { open: "باز", handoff: "نزد کارشناس", ended: "پایان‌یافته" };

function useLinkTo(embed?: boolean) {
  const { orgId } = useOrg();
  return (l: Pick<VaLink, "table" | "id" | "path">) => {
    const to = l.table === "kb_article" ? portalPath(orgId, `kb/${l.id}`) : portalItemTableKeys.includes(l.table) ? ticketPath(orgId, l.table, l.id) : appPath(orgId, l.path);
    return { to, target: embed ? "_blank" : undefined };
  };
}

function CardView({ card, last, busy, onInput, embed }: { card: VaCard; last: boolean; busy: boolean; onInput: (input: VaInput, shown: string) => void; embed?: boolean }) {
  const linkTo = useLinkTo(embed);
  const { orgId } = useOrg();
  switch (card.kind) {
    case "articles":
      return (
        <ol className="m-0 flex flex-col gap-1 ps-5 text-[13px]">
          {card.items.map((a) => (
            <li key={a.id} value={a.n}>
              <Link className="ds-link" {...linkTo(a)}>
                {a.title}
              </Link>
            </li>
          ))}
        </ol>
      );
    case "tickets":
      return (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
          {card.items.map((t) => (
            <li key={t.id} className="pt-confirm flex flex-col gap-0.5">
              <Link className="ds-link font-medium" {...linkTo(t)}>
                {t.number ? <bdi className="ltr">{t.number}</bdi> : null} {t.title}
              </Link>
              <span className="text-ink-3">
                {t.table_label} · {t.state_label}
                {t.updated_at ? ` · ${ago(t.updated_at)}` : ""}
              </span>
              {t.last_reply ? <span className="text-ink-2">آخرین پاسخ: {t.last_reply}</span> : null}
            </li>
          ))}
        </ul>
      );
    case "choices":
      return last ? (
        <div className="pt-choice-row">
          {card.options.map((o) => (
            <Button key={o.value} size="small" disabled={busy} onClick={() => onInput({ action: "choose", value: o.value }, o.label)}>
              {o.label}
            </Button>
          ))}
        </div>
      ) : null;
    case "items":
      return (
        <div className="flex flex-col gap-1.5">
          {card.items.map((it) => (
            <button key={it.id} type="button" className="pt-confirm flex flex-col gap-0.5 text-start" disabled={!last || busy} onClick={() => onInput({ action: "choose", value: it.id }, it.name)}>
              <span className="font-medium">{it.name}</span>
              {it.description ? <span className="text-[12.5px] text-ink-3">{it.description}</span> : null}
            </button>
          ))}
        </div>
      );
    case "question":
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-3">
            پرسش {card.step.toLocaleString("fa-IR")} از {card.steps.toLocaleString("fa-IR")}
            {card.required ? "" : " (اختیاری)"}
          </span>
          {card.help ? <span className="text-[12.5px] text-ink-3">{card.help}</span> : null}
          {last && card.options?.length ? (
            <div className="pt-choice-row">
              {card.options.map((o) => (
                <Button key={o.value} size="small" disabled={busy} onClick={() => onInput({ action: "choose", value: o.value }, o.label)}>
                  {o.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      );
    case "confirm":
      return (
        <div className="pt-confirm flex flex-col gap-2">
          <span className="font-medium">{card.title}</span>
          <dl className="pt-facts">
            {card.rows.map((r) => (
              <div key={r.label} className="contents">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
          {last ? (
            <div className="flex flex-wrap gap-2">
              <Button size="small" type="primary" icon={<Check {...I16} />} disabled={busy} onClick={() => onInput({ action: "confirm" }, "تأیید")}>
                {card.what === "order" ? "ثبت سفارش" : "ثبت گزارش"}
              </Button>
              <Button size="small" icon={<X {...I16} />} disabled={busy} onClick={() => onInput({ action: "cancel" }, "انصراف")}>
                انصراف
              </Button>
            </div>
          ) : null}
        </div>
      );
    case "created":
      return (
        <div className="pt-confirm flex items-center gap-2">
          <Check {...I16} className="text-in" aria-hidden />
          <span>{card.label}:</span>
          <Link className="ds-link" {...linkTo(card.link)}>
            {card.link.number ? <bdi className="ltr">{card.link.number}</bdi> : card.link.title}
          </Link>
        </div>
      );
    case "handoff":
      return (
        <div className="pt-confirm flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <Headset {...I16} aria-hidden /> {card.message}
          </span>
          {card.link ? (
            <Link className="ds-link" {...linkTo(card.link)}>
              پیگیری: {card.link.number ?? card.link.title}
            </Link>
          ) : null}
        </div>
      );
    case "form_link":
      return (
        <div className="pt-confirm flex flex-col gap-1">
          <span className="text-[12.5px] text-ink-3">{card.reason}</span>
          <Link className="ds-link flex items-center gap-1" to={portalPath(orgId, `items/${card.item_id}`)} target={embed ? "_blank" : undefined}>
            <FileText {...I16} aria-hidden /> فرم «{card.name}»
          </Link>
        </div>
      );
  }
}

export default function Chat({ cfg, embed }: { cfg: PortalConfig; embed?: boolean }) {
  const params = useParams();
  const routeId = embed ? null : (params["*"] ?? "").split("/")[0] || null;
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const client = useMemo(() => virtualAgentClient(api), [api]);
  const listKey = [...PORTAL_KEYS.all(orgId), "va", "list"];
  const list = useQuery({ queryKey: listKey, queryFn: () => client.conversations(), staleTime: 15_000 });
  const [convId, setConvId] = useState<string | null>(routeId);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<VaState>("open");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef<string | null>(null);
  const log = useRef<HTMLDivElement>(null);

  // open the conversation of the address (not the one this page just started: its messages are already here)
  useEffect(() => {
    if (embed) return;
    setConvId(routeId);
    if (!routeId) {
      if (!started.current) {
        setMsgs([]);
        setState("open");
        setSuggestions([]);
      }
      return;
    }
    if (started.current === routeId) return;
    started.current = null;
    let live = true;
    setLoading(true);
    setProblem(null);
    setSuggestions([]);
    client
      .messages(routeId)
      .then((m) => live && setMsgs(m))
      .catch((e) => live && setProblem(errorText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [routeId, embed, client]);
  useEffect(() => {
    const c = convId ? list.data?.find((x) => x.id === convId) : null;
    if (c) setState(c.state);
  }, [convId, list.data]);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, suggestions]);

  const apply = (pendingId: string, reply: VaReply) => {
    setMsgs((m) => m.map((x) => (x.id === pendingId ? { id: reply.message_id, role: "agent", text: reply.text, cards: reply.cards, topic: reply.topic, at: new Date().toISOString(), model: reply.model } : x)));
    setSuggestions(reply.suggestions);
    setState(reply.state);
    void qc.invalidateQueries({ queryKey: listKey });
    if (reply.cards.some((c) => c.kind === "created" || c.kind === "handoff")) void qc.invalidateQueries({ queryKey: PORTAL_KEYS.all(orgId) });
  };

  const run = async (shown: string | null, call: (pendingId: string) => Promise<VaReply>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setSuggestions([]);
    const now = new Date().toISOString();
    const pendingId = `pending-${Date.now()}`;
    setMsgs((m) => [...m, ...(shown ? [{ id: `me-${Date.now()}`, role: "user" as const, text: shown, cards: [], topic: null, at: now }] : []), { id: pendingId, role: "agent", text: "", cards: [], topic: null, at: now, pending: true }]);
    try {
      apply(pendingId, await call(pendingId));
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== pendingId));
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const send = (input: VaInput, shown: string) =>
    run(shown, async (pendingId) => {
      if (!convId || state === "ended") {
        const reply = await client.start({ channel: "portal", text: "text" in input ? input.text : shown });
        started.current = reply.conversation_id;
        setConvId(reply.conversation_id);
        if (!embed) navigate(portalPath(orgId, `chat/${reply.conversation_id}`), { replace: !routeId });
        return reply;
      }
      return client.send(convId, input, (delta) => setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, text: x.text + delta } : x))));
    });

  const submit = () => {
    const v = text.trim();
    if (!v || busy) return;
    setText("");
    void send({ text: v }, v);
  };
  const handoff = () => (convId && state === "open" ? run("گفتگو با کارشناس", () => client.handoff(convId)) : send({ text: "گفتگو با کارشناس" }, "گفتگو با کارشناس"));
  const end = () => (convId ? run(null, () => client.end(convId)) : undefined);
  const fresh = () => {
    started.current = null;
    setConvId(null);
    setMsgs([]);
    setState("open");
    setSuggestions([]);
    setProblem(null);
    if (!embed) navigate(portalPath(orgId, "chat"));
  };
  const lastAgent = [...msgs].reverse().find((m) => m.role === "agent" && !m.pending)?.id;

  return (
    <div className={`pt-chat${embed ? " is-embed" : ""}`}>
      {!embed ? (
        <aside className="pt-chat-list flex flex-col gap-2" aria-label="گفتگوهای من">
          <Button icon={<MessageCirclePlus {...I16} />} onClick={fresh}>
            گفتگوی تازه
          </Button>
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {(list.data ?? []).map((c) => (
                <li key={c.id}>
                  <Link to={portalPath(orgId, `chat/${c.id}`)} className="pt-row" aria-current={c.id === convId ? "page" : undefined}>
                    <span className="pt-row-b">
                      <span className="pt-row-t">{c.title || "گفتگو"}</span>
                      <span className="pt-row-m">
                        <span>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                        {c.last_at ? <span>{ago(c.last_at)}</span> : null}
                        {c.state !== "open" ? <span>{STATE_LABEL[c.state]}</span> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {list.data && !list.data.length ? <li className="p-3 text-[13px] text-ink-3">هنوز گفتگویی ندارید.</li> : null}
            </ul>
          </div>
        </aside>
      ) : null}
      <section className="pt-chat-main" aria-label={`گفتگو با ${cfg.portal.chat_name}`}>
        <div className="pt-chat-h">
          <span className="pt-tile-ic" aria-hidden>
            <Bot {...I20} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{cfg.portal.chat_name}</span>
            <span className="text-[12px] text-ink-3">دستیار خودکار{state !== "open" ? ` · ${STATE_LABEL[state]}` : ""}</span>
          </div>
          {state === "open" ? (
            <Tooltip title="گفتگو را به یک کارشناس بسپارید">
              <Button size="small" icon={<Headset {...I16} />} disabled={busy} onClick={() => void handoff()}>
                کارشناس
              </Button>
            </Tooltip>
          ) : null}
          {convId && state !== "ended" ? (
            <Button size="small" type="text" disabled={busy} onClick={() => void end()}>
              پایان
            </Button>
          ) : null}
          {embed && convId ? (
            <Button size="small" type="text" icon={<MessageCirclePlus {...I16} />} aria-label="گفتگوی تازه" onClick={fresh} />
          ) : null}
        </div>
        <div className="pt-chat-log" ref={log} role="log" aria-live="polite" aria-busy={busy || loading}>
          {!msgs.length && !loading ? (
            <div className="pt-msg">
              <span className="pt-msg-m">{cfg.portal.chat_name}</span>
              <div className="pt-msg-b">سلام! من {cfg.portal.chat_name} هستم. می‌توانم به پرسش‌هایتان از روی راهنماها پاسخ دهم، درخواست و گزارش ثبت کنم و وضعیت درخواست‌هایتان را بگویم. هر وقت خواستید، گفتگو را به کارشناس می‌سپارم.</div>
              <div className="pt-choice-row mt-1">
                {STARTERS.map((s) => (
                  <Button key={s} size="small" disabled={busy} onClick={() => void send({ text: s }, s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {msgs.map((m) =>
            m.role === "system" ? (
              <div key={m.id} className="pt-event">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`pt-msg${m.role === "user" ? " is-mine" : ""}`}>
                <span className="pt-msg-m">{m.role === "user" ? "شما" : cfg.portal.chat_name}</span>
                {m.pending && !m.text ? (
                  <div className="pt-msg-b text-ink-3">در حال نوشتن…</div>
                ) : m.text ? (
                  <div className="pt-msg-b">{m.role === "agent" ? <RecordMarkdown text={m.text} /> : <span className="whitespace-pre-wrap">{m.text}</span>}</div>
                ) : null}
                {m.cards.length ? (
                  <div className="pt-cards">
                    {m.cards.map((c, i) => (
                      <CardView key={i} card={c} last={m.id === lastAgent && state !== "ended"} busy={busy} onInput={(input, shown) => void send(input, shown)} embed={embed} />
                    ))}
                  </div>
                ) : null}
                {m.role === "agent" && !m.pending && m.model ? <span className="text-[11px] text-ink-3">نوشتهٔ هوش مصنوعی؛ منبع‌ها را ببینید</span> : null}
              </div>
            ),
          )}
          {suggestions.length && !busy ? (
            <div className="pt-choice-row" aria-label="پاسخ‌های پیشنهادی">
              {suggestions.map((s) => (
                <button key={s} type="button" className="pt-chip-btn" onClick={() => void send({ text: s }, s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          {state === "handoff" ? <Alert type="info" showIcon title="گفتگو به کارشناس سپرده شد" description="پاسخ کارشناس را در «درخواست‌های من» و در اعلان‌ها می‌بینید." /> : null}
          {state === "ended" ? (
            <div className="pt-event">
              این گفتگو پایان یافته است.{" "}
              <button type="button" className="ds-link" onClick={fresh}>
                گفتگوی تازه
              </button>
            </div>
          ) : null}
          {problem ? <Alert type="error" title={problem} /> : null}
        </div>
        <div className="pt-chat-in">
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoSize={{ minRows: 1, maxRows: 6 }}
            maxLength={2000}
            placeholder={state === "ended" ? "برای گفتگوی تازه بنویسید…" : "پیامتان را بنویسید…"}
            aria-label="پیام"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button type="primary" icon={<Send {...I16} />} aria-label="فرستادن" loading={busy} disabled={!text.trim()} onClick={submit} />
        </div>
        <div className="pt-disclose">
          {cfg.portal.chat_name} دستیاری خودکار است و ممکن است اشتباه کند؛ کارهای مهم را پیش از ثبت به شما نشان می‌دهد و هر وقت خواستید، کارشناس پاسخ می‌دهد.
        </div>
      </section>
    </div>
  );
}
