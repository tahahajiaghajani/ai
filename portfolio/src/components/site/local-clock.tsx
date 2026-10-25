"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";

/** Tehran time, ticking (rendered after mount so server and client agree). */
export function LocalClock({ lang }: { lang: Lang }) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tehran", hour12: false });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lang]);
  return (
    <span className="font-mono tabular-nums" suppressHydrationWarning>
      {lang === "fa" ? "تهران" : "Tehran"} · {now || "—"}
    </span>
  );
}
