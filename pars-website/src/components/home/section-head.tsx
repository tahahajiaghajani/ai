import type { ReactNode } from "react";

export function SectionHead({ kicker, title, lead, center = false, children }: { kicker: string; title: string; lead?: string; center?: boolean; children?: ReactNode }) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <span data-reveal className="kicker">
        <span className="h-px w-8 bg-violet/60" />
        {kicker}
      </span>
      <h2 data-reveal style={{ "--d": 1 } as React.CSSProperties} className="display mt-5 text-[clamp(2rem,4.6vw,3.6rem)] text-balance">
        {title}
      </h2>
      {lead && (
        <p data-reveal style={{ "--d": 2 } as React.CSSProperties} className={`mt-5 text-pretty text-base leading-8 text-muted sm:text-lg sm:leading-9 ${center ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>
          {lead}
        </p>
      )}
      {children}
    </div>
  );
}
