import type { ReactNode } from "react";

export function SectionHead({ kicker, title, lead, center = false, children }: { kicker: string; title: string; lead?: string; center?: boolean; children?: ReactNode }) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <span data-reveal className="kicker">
        {kicker}
      </span>
      <h2 data-reveal style={{ "--d": 1 } as React.CSSProperties} className="display mt-5 text-[clamp(1.6rem,3.3vw,2.6rem)] text-balance">
        {title}
      </h2>
      {lead && (
        <p data-reveal style={{ "--d": 2 } as React.CSSProperties} className={`mt-5 text-pretty text-base leading-8 text-muted sm:text-lg sm:leading-9 ${center ? "justified-center mx-auto max-w-2xl" : "justified max-w-2xl"}`}>
          {lead}
        </p>
      )}
      {children}
    </div>
  );
}
