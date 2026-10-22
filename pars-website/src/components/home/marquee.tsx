export function Marquee({ items }: { items: string[] }) {
  const row = [...items, ...items];
  // dir=ltr on the clipping box: in an RTL parent the over-wide track would hang off its left edge
  return (
    <div dir="ltr" className="relative overflow-hidden border-y border-line bg-ink-2/60 py-5 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]" aria-hidden>
      {/* spacing sits inside each item (pe-10, not a gap) so -50% lands exactly on the second copy */}
      <div className="marquee-track flex w-max animate-marquee items-center">
        {row.map((x, i) => (
          <span key={i} className="flex items-center gap-10 pe-10 font-brand text-lg font-semibold whitespace-nowrap text-fg/55">
            {x}
            <svg viewBox="0 0 10 10" className="size-2 text-pink/70" aria-hidden>
              <path d="M5 0l1.4 3.6L10 5 6.4 6.4 5 10 3.6 6.4 0 5l3.6-1.4z" fill="currentColor" />
            </svg>
          </span>
        ))}
      </div>
    </div>
  );
}
