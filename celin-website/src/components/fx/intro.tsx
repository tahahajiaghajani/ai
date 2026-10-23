"use client";

import { useEffect } from "react";

/**
 * The first visit of a session opens on the monogram drawn in copper light, then a curtain lifts
 * (≈1.6s, pure CSS so it always ends). The boot script in <Document> marks later visits «intro-seen».
 */
export function Intro() {
  useEffect(() => {
    const id = setTimeout(() => document.documentElement.classList.add("intro-seen"), 2600);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="fx-intro" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/celin-mark-reverse.svg" alt="" className="fx-intro-mark" width={186} height={256} />
      <span className="fx-intro-line" />
    </div>
  );
}
