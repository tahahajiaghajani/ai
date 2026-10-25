/** Paragraphs from plain text with **bold**, `code` and "- " bullet lines; nothing else is interpreted. */
export function Prose({ text, big = false }: { text: string; big?: boolean }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className={`prose-mono ${big ? "text-[clamp(1.05rem,1.45vw,1.3rem)] leading-[1.75]" : "leading-relaxed"} text-fg-2`}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(b)}</p>;
      })}
    </div>
  );
}

function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}
