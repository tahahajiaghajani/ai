// The portal's big search box (PTL-006): type-ahead over knowledge, services, the person's own requests, topics and
// quick links (not logged), arrow keys and Enter to open a suggestion, Enter on the text for the full results page
// (logged, with the AI answer card). The suggestions list is a listbox the screen reader follows.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Input } from "antd";
import { Search as SearchIcon } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PORTAL_KEYS, portalApi, portalSession, type PortalSearchHit } from "./api";
import { appPath, groupHits, portalPath } from "./model";

export function SearchBar({ initial = "", placeholder = "جست‌وجو در راهنماها، خدمت‌ها و درخواست‌های من…", autoFocus, onSearch }: { initial?: string; placeholder?: string; autoFocus?: boolean; onSearch?: (q: string) => void }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = useDebounced(text.trim(), 250);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const s = useQuery({ queryKey: [...PORTAL_KEYS.search(orgId, q), "ahead"], queryFn: () => portalApi.search(api, q, { log: false, session: portalSession() }), enabled: q.length >= 2, staleTime: 30_000 });
  const groups = useMemo(() => groupHits(s.data?.hits ?? []).map((g) => ({ ...g, hits: g.hits.slice(0, 3) })), [s.data]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => setText(initial), [initial]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (h: PortalSearchHit) => {
    setOpen(false);
    void portalApi.event(api, { kind: "click", query: q, ref_table: h.kind === "article" ? "kb_article" : h.kind === "item" ? "catalog_item" : null, ref_id: h.kind === "article" || h.kind === "item" ? h.id : null });
    if (h.external) window.open(h.path, "_blank", "noopener");
    else navigate(appPath(orgId, h.path));
  };
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setOpen(false);
    if (onSearch) onSearch(v);
    else navigate(`${portalPath(orgId, "search")}?q=${encodeURIComponent(v)}`);
  };

  const showList = open && q.length >= 2 && (flat.length > 0 || (!s.isFetching && s.data));
  let n = -1;
  return (
    <div className="pt-search" ref={box}>
      <Input
        size="large"
        allowClear
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        aria-label="جست‌وجو در درگاه"
        role="combobox"
        aria-expanded={!!showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        prefix={<SearchIcon size={18} strokeWidth={1.5} absoluteStrokeWidth aria-hidden />}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(flat.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (active >= 0 && flat[active]) go(flat[active]);
            else submit();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {showList ? (
        <div className="pt-suggest" id={listId} role="listbox" aria-label="پیشنهادهای جست‌وجو">
          {flat.length ? (
            groups.map((g) => (
              <div key={g.kind} role="group" aria-label={g.label}>
                <div className="pt-suggest-g">{g.label}</div>
                {g.hits.map((h) => {
                  n++;
                  const i = n;
                  return (
                    <div key={`${h.kind}:${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="pt-suggest-i" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseEnter={() => setActive(i)}>
                      <span>{h.title}</span>
                      {h.meta || h.snippet ? <small>{h.meta ?? h.snippet}</small> : null}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="pt-suggest-g">چیزی پیدا نشد؛ Enter را بزنید تا پاسخ هوشمند و همهٔ نتیجه‌ها را ببینید.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
