// The knowledge search box with type-ahead: while typing (after two letters, debounced) the best few articles the
// member may read appear under the box with their matching words marked; Enter or «جست‌وجو» opens the results page,
// ↑/↓ and Enter open an article. Used on the home and the search page; the portal and request forms can reuse it.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { Search } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { KB_KEYS, kbApi, kbSession } from "./api";
import { highlight } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export function SearchBox({ initial = "", size = "large", autoFocus, placeholder = "جست‌وجو در دانش: «تغییر گذرواژه»، «اتصال VPN»…", onSearch }: { initial?: string; size?: "large" | "middle"; autoFocus?: boolean; placeholder?: string; onSearch?: (q: string) => void }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const list = useId();
  const box = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim(), 250);
  useEffect(() => setQ(initial), [initial]);
  const s = useQuery({
    queryKey: KB_KEYS.search(orgId, `ahead:${dq}`),
    queryFn: () => kbApi.search(api, { q: dq, size: 6, channel: "typeahead", session: kbSession(), log: false }),
    enabled: dq.length >= 2 && open,
    staleTime: 30_000,
  });
  const hits = open && dq.length >= 2 ? (s.data?.hits ?? []) : [];
  const go = (text: string) => {
    const t = text.trim();
    setOpen(false);
    if (onSearch) onSearch(t);
    else nav(`/${orgId}/kb/search${t ? `?q=${encodeURIComponent(t)}` : ""}`);
  };
  const openHit = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setOpen(false);
    void kbApi.click(api, h.id, dq, i, kbSession(), "typeahead").catch(() => undefined);
    nav(`/${orgId}/kb/a/${h.id}?q=${encodeURIComponent(dq)}`);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setAt((x) => (x + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setAt((x) => (x <= 0 ? hits.length - 1 : x - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (at >= 0 && hits[at]) openHit(at);
      else go(q);
    } else if (e.key === "Escape") setOpen(false);
  };
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, []);
  return (
    <div className="kb-search relative" ref={box}>
      <div className="flex gap-2">
        <Input
          size={size}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setAt(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={keys}
          placeholder={placeholder}
          prefix={<Search {...I16} className="text-ink-3" />}
          allowClear
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={list}
          aria-autocomplete="list"
          aria-label="جست‌وجو در دانش"
          maxLength={300}
        />
        <Button size={size} type="primary" onClick={() => go(q)}>
          جست‌وجو
        </Button>
      </div>
      {hits.length ? (
        <ul id={list} role="listbox" className="kb-suggest ds-pop absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-line bg-raised text-start shadow-e3">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === at}>
              <button type="button" className={`flex w-full flex-col gap-0.5 border-0 px-3 py-2 text-start ${i === at ? "bg-sunken" : "bg-transparent"} hover:bg-sunken`} onMouseEnter={() => setAt(i)} onClick={() => openHit(i)}>
                <span className="text-[14px] text-ink">
                  <Marked text={h.title} terms={s.data?.terms ?? []} />
                </span>
                {h.summary ? <span className="line-clamp-1 text-[12px] text-ink-3">{h.summary}</span> : null}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="w-full border-0 border-t border-line bg-transparent px-3 py-2 text-start text-[13px] text-ink-2 hover:bg-sunken" onClick={() => go(q)}>
              همهٔ نتیجه‌ها برای «{q.trim()}»
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
