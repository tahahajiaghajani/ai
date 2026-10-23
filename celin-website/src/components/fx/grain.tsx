/** Film grain over a band (last child of a `relative` box). */
export function Grain({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`grain ${className}`} />;
}
