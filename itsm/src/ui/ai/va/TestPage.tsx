// «دستیار مجازی (آزمایش)»: a minimal page to talk to the virtual agent's brain as yourself — the requester UI and the
// messaging channels come with the portal module (they call the same adapter, src/ui/ai/va/api.ts). Cards are drawn
// plainly: links, choices, questions, confirmations.
import "../agents/agents.css";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Input } from "antd";
import type { VaCard, VaInput, VaReply } from "@shared/ai/va";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { virtualAgentClient } from "./api";

interface Line {
  id: string;
  role: "user" | "agent";
  text: string;
  cards: VaCard[];
  meta?: string;
}

function Card({ c, orgId, onInput }: { c: VaCard; orgId: string; onInput: (i: VaInput) => void }) {
  const link = (path: string, label: string) => (
    <Link to={`/${orgId}/${path}`} className="ds-link">
      {label}
    </Link>
  );
  switch (c.kind) {
    case "articles":
      return (
        <ul>
          {c.items.map((a) => (
            <li key={`${a.n}-${a.id}`}>
              [{fa(a.n)}] {link(a.path, a.title)}
            </li>
          ))}
        </ul>
      );
    case "tickets":
      return (
        <ul>
          {c.items.map((t) => (
            <li key={t.id}>
              {link(t.path, `${t.number ?? ""} ${t.title}`.trim())} — {t.state_label}
              {t.last_reply ? <div className="va-meta">آخرین پاسخ: {t.last_reply}</div> : null}
            </li>
          ))}
        </ul>
      );
    case "choices":
    case "items":
    case "question": {
      const options = c.kind === "items" ? c.items.map((i) => ({ value: i.id, label: i.name })) : c.kind === "choices" ? c.options : (c.options ?? []);
      return (
        <div className="flex flex-wrap gap-2">
          {c.kind === "question" ? <span className="va-meta ds-num">پرسش {fa(c.step)} از {fa(c.steps)}</span> : null}
          {options.map((o) => (
            <Button key={o.value} size="small" onClick={() => onInput({ action: "choose", value: o.value })}>
              {o.label}
            </Button>
          ))}
        </div>
      );
    }
    case "confirm":
      return (
        <div className="grid gap-1">
          <b>{c.title}</b>
          {c.rows.map((r) => (
            <div key={r.label}>
              {r.label}: {r.value}
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="small" type="primary" onClick={() => onInput({ action: "confirm" })}>
              ثبت کن
            </Button>
            <Button size="small" onClick={() => onInput({ action: "cancel" })}>
              لغو
            </Button>
          </div>
        </div>
      );
    case "created":
      return <div>{link(c.link.path, `${c.label}: ${c.link.number ?? c.link.title}`)}</div>;
    case "handoff":
      return <div>{c.link ? link(c.link.path, `${c.message}: ${c.link.number ?? c.link.title}`) : c.message}</div>;
    case "form_link":
      return <div>{link(c.path, `فرم سفارش «${c.name}»`)}</div>;
  }
}

export default function VirtualAgentTestPage() {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const va = useMemo(() => virtualAgentClient(api), [api]);
  const [conv, setConv] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const push = (l: Line) => {
    setLines((xs) => [...xs, l]);
    requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight }));
  };
  const show = (r: VaReply) => {
    setConv(r.conversation_id);
    push({ id: r.message_id, role: "agent", text: r.text, cards: r.cards, meta: [r.topic ? `موضوع: ${r.topic}` : null, `مسیر: ${r.route}`, r.model ? `مدل: ${r.model}` : "بی‌مدل"].filter(Boolean).join(" · ") });
  };
  const send = async (input: VaInput) => {
    if (busy) return;
    setBusy(true);
    try {
      if ("text" in input) push({ id: `u${Date.now()}`, role: "user", text: input.text, cards: [] });
      show(conv ? await va.send(conv, input) : await va.start({ channel: "test", text: "text" in input ? input.text : null }));
      setText("");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const begin = async () => {
    setLines([]);
    setConv(null);
    setBusy(true);
    try {
      show(await va.start({ channel: "test" }));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const handoff = async () => {
    if (!conv) return;
    try {
      show(await va.handoff(conv));
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div>
      <PageHeader
        title="دستیار مجازی (آزمایش)"
        actions={
          <>
            <Button onClick={() => void begin()}>گفتگوی تازه</Button>
            <Button disabled={!conv} onClick={() => void handoff()}>
              واگذاری به کارشناس
            </Button>
          </>
        }
      />
      <div className="va-page">
        <div className="va-log" ref={log} aria-live="polite">
          {lines.map((l) => (
            <div key={l.id} className={`va-msg is-${l.role}`}>
              {l.text}
              {l.cards.map((c, i) => (
                <div key={i} className="va-card">
                  <Card c={c} orgId={orgId} onInput={(x) => void send(x)} />
                </div>
              ))}
              {l.meta ? <div className="va-meta">{l.meta}</div> : null}
            </div>
          ))}
        </div>
        <div className="va-send">
          <Input value={text} onChange={(e) => setText(e.target.value)} onPressEnter={() => text.trim() && void send({ text: text.trim() })} placeholder="پیام خود را بنویسید" disabled={busy} aria-label="پیام" />
          <Button type="primary" loading={busy} disabled={!text.trim()} onClick={() => void send({ text: text.trim() })}>
            فرستادن
          </Button>
        </div>
      </div>
    </div>
  );
}
