// The sidebar footer's sync state (components.md §1.2 table): the nuqta, the state word and the time.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tooltip } from "antd";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { fa, jTime, jDate } from "../../lib/fa";

interface LocalSync {
  linked: boolean;
  running: boolean;
  online: boolean | null;
  pending: number;
  last_sync_at: string | null;
  last_error: string | null;
}

export type SyncTone = "live" | "syncing" | "offline" | "failed" | "local" | "web";

export interface SyncState {
  tone: SyncTone;
  word: string;
  meta: string | null;
  detail: string | null;
  retry?: () => void;
}

/** «همین حالا»، «۲ دقیقه پیش»، «۳ ساعت پیش»، otherwise the time or the date. */
export function ago(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "همین حالا";
  const m = Math.round(s / 60);
  if (m < 60) return `${fa(m)} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 24 && new Date(t).toDateString() === new Date(now).toDateString()) return `ساعت ${jTime(t)}`;
  return jDate(t);
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function useSyncState(): SyncState {
  const { meta } = useSession();
  const desktop = meta?.mode === "desktop";
  const now = useNow();
  const q = useQuery({
    queryKey: ["local-sync"],
    queryFn: () => api.get<LocalSync>("/local/sync"),
    enabled: desktop,
    refetchInterval: 8000,
  });
  if (!desktop) return { tone: "web", word: "نسخهٔ وب", meta: null, detail: "داده‌ها مستقیم در فضای ابری ذخیره می‌شوند." };
  const s = q.data;
  const retry = () => void api.post("/local/sync").then(() => q.refetch());
  if (!s?.linked) return { tone: "local", word: "روی همین رایانه", meta: null, detail: "برای هم‌گامی با نسخهٔ وب، از تنظیمات ← نسخهٔ ویندوز وصل شوید." };
  if (s.last_error) return { tone: "failed", word: "هم‌گامی متوقف شد", meta: null, detail: s.last_error, retry };
  if (s.online === false) return { tone: "offline", word: "بی‌اینترنت", meta: s.pending ? `${fa(s.pending)} تغییر در صف` : null, detail: "تغییرها پس از وصل شدن فرستاده می‌شوند.", retry };
  if (s.running) return { tone: "syncing", word: "در حال هم‌گامی", meta: s.pending ? `${fa(s.pending)} تغییر` : null, detail: null };
  return {
    tone: "live",
    word: "هم‌گام",
    meta: s.pending ? `${fa(s.pending)} تغییر در صف` : ago(s.last_sync_at, now),
    detail: s.last_sync_at ? `آخرین هم‌گامی: ${jDate(new Date(s.last_sync_at))}، ${jTime(new Date(s.last_sync_at))}` : null,
    retry,
  };
}

/** The 7 px rhombic nuqta in the tone's colour (pulses only while syncing: the one loop). */
export function SyncNuqta({ tone }: { tone: SyncTone }) {
  if (tone === "web") return null;
  return <span className={`sf-nuqta sh-nuqta sh-nuqta-${tone} ${tone === "syncing" ? "sf-pulse" : ""}`} {...(tone === "live" || tone === "syncing" ? { "data-live": "" } : {})} aria-hidden />;
}

export function SyncLine({ state }: { state: SyncState }) {
  const body = (
    <span className="sh-sync">
      <SyncNuqta tone={state.tone} />
      <span className="sh-sync-word">{state.word}</span>
      {state.meta ? (
        <>
          <span className="sh-sep" aria-hidden />
          <span className="sh-sync-meta">{state.meta}</span>
        </>
      ) : null}
      {state.tone === "failed" && state.retry ? (
        <button type="button" className="sf-link sh-sync-retry" onClick={state.retry}>
          تلاش دوباره
        </button>
      ) : null}
    </span>
  );
  return state.detail ? (
    <Tooltip title={state.detail} placement="top">
      {body}
    </Tooltip>
  ) : (
    body
  );
}
