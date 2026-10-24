import { useId } from "react";

/**
 * The PRO seal: a small espresso arch in a champagne–copper rim, PRO engraved in champagne, a keystone at the
 * crown. Decorative (the text beside it says what it means). `sm` sits beside a line of text (bars, the product
 * box), `md` heads a panel, `lg` a sheet.
 */
export function ProSeal({ className = "", large = false, size }: { className?: string; large?: boolean; size?: "sm" | "md" | "lg" }) {
  const s = size ?? (large ? "lg" : "sm");
  return (
    <span aria-hidden data-size={s} className={`pro-seal ltr ${className}`}>
      <span className="pro-seal-word">PRO</span>
    </span>
  );
}

/** Text engraved around the hallmark's rim (Latin, like a hallmark; the house's own names only). */
const RIM = "CELIN · ETEMAD GALLERY · PRO MEMBERS · ";

/**
 * The PRO hallmark: a round engraved seal — double rim, the house's names around it, a small arch with its
 * keystone and PRO in the Didone of the wordmark. `night` sits on an espresso disc (dark grounds and the
 * ceremony), `light` is lines only (copper, light grounds). Inside a `[data-pro-state="ok"]` box it turns and
 * glows once (the code was accepted). Decorative.
 */
export function ProHallmark({ className = "", tone = "night" }: { className?: string; tone?: "night" | "light" }) {
  const id = `h${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const metal = `url(#${id}m)`;
  return (
    <svg viewBox="0 0 160 160" aria-hidden data-tone={tone} className={`pro-hallmark ltr ${className}`}>
      <defs>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1">
          {[0, 0.26, 0.46, 0.6, 0.8, 1].map((o, i) => (
            <stop key={o} offset={o} className={`hm-m${i}`} />
          ))}
        </linearGradient>
        <radialGradient id={`${id}d`} cx="0.5" cy="0.32" r="0.75">
          <stop offset="0" className="hm-d0" />
          <stop offset="0.55" className="hm-d1" />
          <stop offset="1" className="hm-d2" />
        </radialGradient>
        <path id={`${id}r`} d="M16 80a64 64 0 1 1 128 0a64 64 0 1 1-128 0" />
      </defs>
      {tone === "night" && <circle cx="80" cy="80" r="79" fill={`url(#${id}d)`} />}
      <circle cx="80" cy="80" r="78.4" fill="none" stroke={metal} strokeWidth="1.2" />
      <circle cx="80" cy="80" r="74.5" fill="none" stroke={metal} strokeWidth="0.5" opacity="0.7" />
      <g className="pro-hallmark-rim">
        <text fill={metal} fontSize="7.6" style={{ fontFamily: "var(--font-latin-ui), sans-serif", fontWeight: 500 }}>
          <textPath href={`#${id}r`} textLength="398" lengthAdjust="spacing">
            {RIM}
          </textPath>
        </text>
      </g>
      <circle cx="80" cy="80" r="57.5" fill="none" stroke={metal} strokeWidth="0.8" />
      <circle cx="80" cy="80" r="54.5" fill="none" stroke={metal} strokeWidth="0.4" opacity="0.6" />
      {/* the arch and its keystone */}
      <path d="M68 70V60.5a12 12 0 0 1 24 0V70" fill="none" stroke={metal} strokeWidth="0.8" />
      <path d="M80 44.2 82.6 46.8 80 49.4 77.4 46.8Z" fill={metal} />
      <text x="81.6" y="93" textAnchor="middle" fill={metal} fontSize="23" letterSpacing="3.2" className="pro-hallmark-word" style={{ fontFamily: "var(--font-latin-display), serif", fontWeight: 500 }}>
        PRO
      </text>
      <path d="M62 102.5h14.6M83.4 102.5H98" stroke={metal} strokeWidth="0.6" />
      <path d="M80 100.3 82.2 102.5 80 104.7 77.8 102.5Z" fill={metal} />
      {/* a glint on the rim */}
      <path className="pro-hallmark-glint" d="M124 30.5c.5 3.2 1.3 4 4.5 4.5-3.2.5-4 1.3-4.5 4.5-.5-3.2-1.3-4-4.5-4.5 3.2-.5 4-1.3 4.5-4.5Z" />
    </svg>
  );
}
