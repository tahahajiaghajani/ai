// The command palette (components.md §1.4): strong glass over the scrim, no open/close animation,
// grouped results («اخیر»، «کارها»، «صفحه‌ها»، «اشخاص»، «اسناد و فاکتورها»), matched characters in ink 600,
// the selected row with the 2 × 16 Dusk start bar, and keyboard hints in the footer.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, CornerDownLeft, History, User, FileText, Receipt, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, type LucideIcon } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { normalizeFa, toLatinDigits, docNo, jDate } from "../../lib/fa";
import { ChequeIcon, Ic, Keys, AiIcon } from "./icons";
import { readJSON, recentKey, spaceOf, useRelPath, useShellItems, type Recent } from "./model";
import { INVOICE_KINDS, INVOICE_META, type InvoiceKind } from "../../modules/goods/labels";
import { openAssistant } from "../../ai/assistant/bus";
import { pageContext } from "../../ai/assistant/context";
import { looksLikeQuestion, suggestionsFor } from "../../ai/assistant/prompts";
import { switchedOff, useAiStatus, useCanAsk } from "../../ai/assistant/useAi";

export interface PaletteCommand {
  key: string;
  /** Org-relative path the command opens: left out of the empty palette while that page is open. */
  path?: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
  meta?: string;
  run: () => void;
}

interface Row {
  id: string;
  group: string;
  icon: LucideIcon;
  label: string;
  hl?: number[];
  meta?: string;
  keys?: string[];
  run: () => void;
}

// ---------------------------------------------------------------- matching
/** Normalises per character, keeping the map back to the original string (for highlighting). */
function normMap(s: string): { n: string; map: number[] } {
  let n = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const t = /\s/.test(c) ? " " : normalizeFa(c);
    for (const ch of t) {
      n += ch;
      map.push(i);
    }
  }
  return { n, map };
}

/** Score (0 = no match) and the matched original indices. Whole-word prefix > word anywhere > fuzzy. */
function score(label: string, extra: string, query: string): { s: number; hl: number[] } {
  const q = normalizeFa(query);
  if (!q) return { s: 0, hl: [] };
  const { n, map } = normMap(label);
  const words = q.split(" ").filter(Boolean);
  const hl: number[] = [];
  const mark = (from: number, len: number) => {
    for (let k = from; k < from + len; k++) if (map[k] !== undefined) hl.push(map[k]);
  };
  // the whole query as a prefix of the label or of one of its words
  const at = n.indexOf(q);
  if (at === 0 || (at > 0 && n[at - 1] === " ")) {
    mark(at, q.length);
    return { s: at === 0 ? 4 : 3, hl };
  }
  // every query word inside the label
  if (words.every((w) => n.includes(w))) {
    let wordStarts = 0;
    for (const w of words) {
      const i = n.indexOf(w);
      if (i === 0 || n[i - 1] === " ") wordStarts++;
      mark(i, w.length);
    }
    return { s: 2 + wordStarts / (words.length * 2), hl };
  }
  // keywords, group or meta
  const all = normalizeFa(`${label} ${extra}`);
  if (words.every((w) => all.includes(w))) return { s: 1, hl: [] };
  // fuzzy: the query's letters in order inside the label
  const qq = q.replace(/ /g, "");
  let j = 0;
  const fz: number[] = [];
  for (let i = 0; i < n.length && j < qq.length; i++) if (n[i] === qq[j]) (fz.push(map[i]), j++);
  if (qq.length >= 2 && j === qq.length) return { s: 0.5, hl: fz };
  return { s: 0, hl: [] };
}

function Label({ text, hl }: { text: string; hl?: number[] }) {
  if (!hl?.length) return <>{text}</>;
  const set = new Set(hl);
  const out: ReactNode[] = [];
  let buf = "";
  let on = false;
  const flush = (k: number) => {
    if (buf) out.push(on ? <mark key={k}>{buf}</mark> : <Fragment key={k}>{buf}</Fragment>);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== on) {
      flush(i);
      on = m;
    }
    buf += text[i];
  }
  flush(text.length);
  return <>{out}</>;
}

// ---------------------------------------------------------------- palette
export function CommandPalette({ open, onClose, commands = [] }: { open: boolean; onClose: () => void; commands?: PaletteCommand[] }) {
  if (!open) return null;
  return createPortal(<Palette onClose={onClose} commands={commands} />, document.body);
}

const DOCS = "اسناد و فاکتورها";
const ASK = "از دستیار بپرسید";

const GROUP_ORDER = ["اخیر", "کارها", "صفحه‌ها", "اشخاص", DOCS];

const TREASURY_KIND: Record<string, { label: string; icon: LucideIcon }> = {
  receipt: { label: "دریافت", icon: ArrowDownToLine },
  payment: { label: "پرداخت", icon: ArrowUpFromLine },
  transfer: { label: "انتقال", icon: ArrowLeftRight },
};

interface DocHit {
  id: string;
  no: number;
  date: string | null;
  kind?: string;
  party_name?: string | null;
  buyer_name?: string | null;
  description?: string | null;
}

function Palette({ onClose, commands }: { onClose: () => void; commands: PaletteCommand[] }) {
  const items = useShellItems();
  const { orgId, api, can, has } = useOrg();
  const nav = useNavigate();
  const rel = useRelPath();
  const { search } = useLocation();
  const here = rel + search;
  const aiStatus = useAiStatus();
  const askable = useCanAsk() && !switchedOff(aiStatus.data);
  const canDraft = aiStatus.data?.can_propose ?? can("ai", "edit");
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const dq = useDebounced(q.trim(), 180);

  // focus the input synchronously, give the focus back on close
  useLayoutEffect(() => {
    input.current?.focus();
    const prev = back.current;
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, []);

  const go = (path: string) => {
    onClose();
    nav(`/${orgId}${path ? `/${path}` : ""}`);
  };

  // records: people by name/code; vouchers, invoices, receipts/payments and cheques by number
  const digits = toLatinDigits(dq).replace(/[^\d]/g, "");
  const isNumber = !!dq && /^[\d۰-۹٠-٩\s]+$/.test(dq);
  const invoiceKinds = has("goods") ? INVOICE_KINDS.filter((k) => can(INVOICE_META[k].area)) : [];
  const parties = useQuery({
    queryKey: ["palette-parties", orgId, dq],
    queryFn: () => api.get<{ options: { id: string; label: string; sub?: string | null }[] }>("/data/party/options", { q: dq }),
    enabled: dq.length >= 2 && can("parties"),
    staleTime: 30_000,
  });
  const vouchers = useQuery({
    queryKey: ["palette-vouchers", orgId, digits],
    queryFn: () => api.get<{ rows: DocHit[] }>("/accounting/vouchers", { q: digits, size: 20 }),
    enabled: isNumber && !!digits && can("accounting"),
    staleTime: 30_000,
  });
  const invoices = useQuery({
    queryKey: ["palette-invoices", orgId, digits, invoiceKinds.join(",")],
    queryFn: () => api.get<{ rows: DocHit[] }>("/goods/invoices", { kind: invoiceKinds.join(","), q: digits, sort: "no", dir: "asc", size: 20 }),
    enabled: isNumber && !!digits && invoiceKinds.length > 0,
    staleTime: 30_000,
  });
  const tdocs = useQuery({
    queryKey: ["palette-treasury", orgId, digits],
    queryFn: () => api.get<{ rows: DocHit[] }>("/treasury/docs", { q: digits, sort: "no", dir: "asc", size: 20 }),
    enabled: isNumber && !!digits && can("treasury"),
    staleTime: 30_000,
  });
  // cheque serials are long: a short number would match half the cheque book
  const cheques = useQuery({
    queryKey: ["palette-cheques", orgId, digits],
    queryFn: () =>
      api.get<{ rows: { id: string; direction: string; serial_no: string | null; sayad_no: string | null; bank_name: string | null; due_date: string | null }[] }>("/treasury/cheques", { q: digits, size: 3 }),
    enabled: isNumber && digits.length >= 3 && can("treasury"),
    staleTime: 30_000,
  });

  const rows = useMemo<Row[]>(() => {
    const s = q.trim();
    const out: Row[] = [];
    const pageRow = (i: (typeof items)[number], group: string, hl?: number[]): Row => ({
      id: `${group}-${i.key}`,
      group,
      icon: i.icon ?? FileText,
      label: i.label,
      hl,
      meta: i.common ? undefined : spaceOf(i.space).title,
      run: () => go(i.path),
    });
    if (!s) {
      // the page that is open is never offered again
      const recents = readJSON<Recent[]>(recentKey(orgId), []).filter((r) => r.path !== here);
      for (const r of recents) {
        const it = r.key ? items.find((i) => i.key === r.key) : null;
        out.push({ id: `r-${r.path}`, group: "اخیر", icon: it?.icon ?? History, label: r.label, meta: it && !it.common ? spaceOf(it.space).title : undefined, run: () => go(r.path) });
      }
      // questions for the assistant about this page, right after the recent pages
      if (askable) {
        const record = pageContext(rel, search, null).record?.type ?? null;
        for (const sg of suggestionsFor(rel, { has, canDraft, recordType: record }, 3))
          out.push({
            id: `s-${sg.key}`,
            group: ASK,
            icon: AiIcon,
            label: sg.fill ? `${sg.text}…` : sg.text,
            run: () => (onClose(), openAssistant({ prompt: sg.text, send: !sg.fill })),
          });
      }
      for (const i of items.filter((x) => x.action && x.path !== here)) out.push(pageRow(i, "کارها"));
      for (const c of commands.filter((x) => x.path === undefined || x.path !== here)) out.push({ id: `c-${c.key}`, group: "کارها", icon: c.icon, label: c.label, meta: c.meta, run: () => (onClose(), c.run()) });
      return out;
    }
    const scored: { row: Row; s: number }[] = [];
    for (const i of items) {
      const m = score(i.label, `${i.keywords ?? ""} ${i.group} ${spaceOf(i.space).title} ${i.section ?? ""}`, s);
      if (m.s) scored.push({ row: pageRow(i, i.action ? "کارها" : "صفحه‌ها", m.hl), s: m.s });
    }
    for (const c of commands) {
      const m = score(c.label, c.keywords ?? "", s);
      if (m.s) scored.push({ row: { id: `c-${c.key}`, group: "کارها", icon: c.icon, label: c.label, hl: m.hl, meta: c.meta, run: () => (onClose(), c.run()) }, s: m.s });
    }
    scored.sort((a, b) => b.s - a.s);
    out.push(...scored.map((x) => x.row));
    for (const p of parties.data?.options?.slice(0, 5) ?? []) {
      out.push({ id: `p-${p.id}`, group: "اشخاص", icon: User, label: p.label, hl: score(p.label, "", s).hl, meta: p.sub ?? undefined, run: () => go(`parties/${p.id}`) });
    }
    const when = (d: string | null | undefined) => (d ? jDate(new Date(d)) : null);
    // the lists also match the number inside references, mobiles and descriptions (hence the ascending number
    // order above, which brings the exact numbers forward): a document is found by its own number
    const no = Number(digits);
    const exact = <T extends { no: number }>(rows: T[] | undefined, max: number) => (rows ?? []).filter((r) => Number(r.no) === no).slice(0, max);
    const docMeta = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("، ") || undefined;
    for (const v of exact(vouchers.data?.rows, 3)) {
      out.push({ id: `v-${v.id}`, group: DOCS, icon: FileText, label: `سند ${docNo(v.no)}`, meta: docMeta(v.description, when(v.date)), run: () => go(`accounting/vouchers/${v.id}`) });
    }
    for (const v of exact(invoices.data?.rows, 5)) {
      const m = INVOICE_META[(v.kind as InvoiceKind) ?? "sale"];
      if (!m) continue;
      out.push({ id: `i-${v.id}`, group: DOCS, icon: Receipt, label: `${m.title} ${docNo(v.no)}`, meta: docMeta(v.party_name ?? v.buyer_name, when(v.date)), run: () => go(`${m.path}/${v.id}`) });
    }
    for (const v of exact(tdocs.data?.rows, 3)) {
      const k = TREASURY_KIND[v.kind ?? ""] ?? TREASURY_KIND.receipt;
      out.push({ id: `t-${v.id}`, group: DOCS, icon: k.icon, label: `${k.label} ${docNo(v.no)}`, meta: docMeta(v.party_name ?? v.description, when(v.date)), run: () => go(`treasury/docs/${v.id}`) });
    }
    for (const c of cheques.data?.rows ?? []) {
      out.push({
        id: `q-${c.id}`,
        group: DOCS,
        icon: ChequeIcon,
        label: `چک ${c.direction === "issued" ? "پرداختی" : "دریافتی"} ${c.serial_no ?? c.sayad_no ?? ""}`.trim(),
        meta: docMeta(c.bank_name, c.due_date ? `سررسید ${when(c.due_date)}` : null),
        run: () => go(`treasury/cheques${c.direction === "issued" ? "/issued" : ""}?open=${c.id}`),
      });
    }
    out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    // «بپرس از دستیار»: first for a question (or when nothing else matched), otherwise after the matches
    if (askable && s.length >= 2) {
      const ask: Row = { id: "ask", group: ASK, icon: AiIcon, label: `بپرس از دستیار: «${s}»`, run: () => (onClose(), openAssistant({ prompt: s, send: true })) };
      if (looksLikeQuestion(s) || !out.length) out.unshift(ask);
      else out.splice(Math.min(out.length, 39), 0, ask);
    }
    return out.slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, digits, items, commands, parties.data, vouchers.data, invoices.data, tdocs.data, cheques.data, orgId, here, askable, canDraft]);

  useEffect(() => setIdx(0), [q]);
  const sel = Math.min(idx, Math.max(0, rows.length - 1));

  // keep the selection in view (instantly: keyboard movement never animates)
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length) setIdx((sel + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) setIdx((sel - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[sel]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (q) setQ("");
      else onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the focus stays in the dialog
    }
  };

  const loading = (parties.isFetching || vouchers.isFetching || invoices.isFetching || tdocs.isFetching || cheques.isFetching) && !rows.length;
  let n = -1;
  return (
    <div className="sh-pal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sh-pal sf-layer-raised" role="dialog" aria-modal="true" aria-label="جست‌وجو و فرمان" onKeyDown={onKey}>
        <div className="sh-pal-in">
          <Ic icon={Search} size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجو یا فرمان…"
            aria-label="جست‌وجو یا فرمان"
            role="combobox"
            aria-expanded="true"
            aria-controls="sh-pal-list"
            aria-activedescendant={rows[sel] ? `sh-pal-${sel}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="sf-end">
            <Keys keys={["Esc"]} />
          </span>
        </div>
        <div className="sh-pal-list" id="sh-pal-list" role="listbox" ref={list}>
          {rows.map((r, i) => {
            const head = i === 0 || rows[i - 1].group !== r.group;
            n++;
            const k = n;
            return (
              <Fragment key={r.id}>
                {head ? (
                  <div className="sh-pal-g" role="presentation">
                    {r.group}
                  </div>
                ) : null}
                <div
                  id={`sh-pal-${k}`}
                  data-i={k}
                  role="option"
                  aria-selected={k === sel}
                  className={`sh-pal-r ${k === sel ? "is-on" : ""}`}
                  onMouseMove={() => k !== sel && setIdx(k)}
                  onClick={() => r.run()}
                >
                  <Ic icon={r.icon} />
                  <span className="sh-pal-label">
                    <Label text={r.label} hl={r.hl} />
                  </span>
                  {r.meta ? <span className="sh-pal-meta">{r.meta}</span> : null}
                  {k === sel ? (
                    <span className="sf-end sh-pal-enter" aria-hidden>
                      <Ic icon={CornerDownLeft} size={14} />
                    </span>
                  ) : null}
                </div>
              </Fragment>
            );
          })}
          {!rows.length && q.trim() && !loading ? (
            <div className="sh-pal-empty">
              <div className="sh-pal-empty-t">برای «{q.trim()}» چیزی پیدا نشد.</div>
              <button type="button" className="sf-link" onClick={() => go("help")}>
                جست‌وجو در راهنما
              </button>
            </div>
          ) : null}
          {!rows.length && loading ? <div className="sh-pal-empty sh-pal-empty-t">در حال جست‌وجو…</div> : null}
        </div>
        <div className="sh-pal-f" aria-hidden>
          <span>
            <Keys keys={["↵"]} />
            باز کردن
          </span>
          <span>
            <Keys keys={["↑", "↓"]} />
            جابه‌جایی
          </span>
          <span>
            <Keys keys={["Esc"]} />
            بستن
          </span>
        </div>
      </div>
    </div>
  );
}
