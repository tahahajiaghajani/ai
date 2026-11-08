// Deflection while ordering (KB-050): under the request form — and first on «گزارش مشکل» — the articles the person may
// read that match what they are typing (POST /knowledge/suggest, debounced, logged in the knowledge session); an
// article opens in a new tab, and «مشکلم حل شد» records the deflection (POST /knowledge/deflect) and closes the form
// without a request. The request module renders it through its order assist slot (request/slots.ts).
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { BookOpenText } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced, useNotify } from "../../lib/hooks";
import type { OrderAssistProps } from "../request/slots";
import { KB_KEYS, kbApi, kbSession } from "./api";
import { Marked } from "./SearchBox";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function Deflection({ text, itemType, onSolved }: OrderAssistProps) {
  const { api, orgId } = useOrg();
  const notify = useNotify();
  const q = useDebounced(text.trim(), 400);
  const s = useQuery({
    queryKey: KB_KEYS.search(orgId, `deflect:${q}`),
    queryFn: () => kbApi.suggest(api, q, kbSession(), "order"),
    enabled: q.length >= 3,
    staleTime: 30_000,
  });
  const hits = q.length >= 3 ? (s.data?.hits ?? []).slice(0, 4) : [];
  if (!hits.length) return null;
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  const solved = async (articleId: string | null) => {
    try {
      await kbApi.deflect(api, articleId, q, kbSession());
    } catch {
      // the deflection is analytics only; the form still closes
    }
    notify.ok("خوشحالیم که مشکل حل شد.");
    onSolved();
  };
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3" aria-label="مقاله‌های مرتبط">
      <h3 className="ds-t-section flex items-center gap-2">
        <BookOpenText {...I14} /> {itemType === "record_producer" ? "پیش از ثبت، شاید این‌ها کمک کند" : "مقاله‌های مرتبط"}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {hits.map((h, i) => (
          <li key={h.id} className="flex flex-col">
            <a
              className="ds-link text-[13px]"
              href={`/${orgId}/kb/a/${h.id}?q=${encodeURIComponent(q)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => void kbApi.click(api, h.id, q, i, kbSession(), "order").catch(() => undefined)}
            >
              <Marked text={h.title} terms={terms} />
            </a>
            {h.snippet ? <span className="text-[12px] text-ink-3">{h.snippet}</span> : null}
          </li>
        ))}
      </ul>
      <div>
        <Button size="small" onClick={() => void solved(hits.length === 1 ? hits[0].id : null)}>
          مشکلم حل شد
        </Button>
      </div>
    </section>
  );
}
