import { Fragment } from "react";

const BULLET = /^\s*[-•]\s+/;

/**
 * Paragraphs from plain text with **bold**, `code` and "- " bullet lines; nothing else is interpreted. Blank lines
 * separate blocks; inside a block, consecutive bullet lines become a list and other lines keep their line breaks.
 */
export function Prose({ text, big = false }: { text: string; big?: boolean }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className={`prose-mono ${big ? "text-[clamp(1.05rem,1.45vw,1.3rem)] leading-[1.75]" : "leading-relaxed"} text-fg-2`}>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {runs(b).map((r, j) =>
            r.list ? (
              <ul key={j}>
                {r.lines.map((l, k) => (
                  <li key={k}>{inline(l.replace(BULLET, ""))}</li>
                ))}
              </ul>
            ) : (
              <p key={j}>
                {r.lines.map((l, k) => (
                  <Fragment key={k}>
                    {k ? <br /> : null}
                    {inline(l)}
                  </Fragment>
                ))}
              </p>
            ),
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** A block's lines grouped into runs of bullets and runs of text; a single-line block is one run, as before. */
function runs(block: string): { list: boolean; lines: string[] }[] {
  const lines = block.split("\n");
  const out: { list: boolean; lines: string[] }[] = [];
  for (const l of lines.length > 1 ? lines.filter((x) => x.trim()) : lines) {
    const list = BULLET.test(l);
    const last = out[out.length - 1];
    if (last && last.list === list) last.lines.push(l);
    else out.push({ list, lines: [l] });
  }
  return out;
}

function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}
