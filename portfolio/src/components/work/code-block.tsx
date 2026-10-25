import { highlight } from "@/lib/highlight";
import { CopyButton } from "@/components/work/copy-button";

/** A code excerpt in a window frame: file name, language, copy, and numbered lines. */
export function CodeBlock({ code, lang, file, title }: { code: string; lang: string; file: string; title: string }) {
  const html = highlight(code.replace(/\s+$/, ""), lang);
  const lines = html.split("\n");
  return (
    <figure className="overflow-hidden rounded-[6px] border border-line bg-bg-2">
      <figcaption className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex gap-1.5">
            <span className="size-2.5 rounded-full border border-line-strong" />
            <span className="size-2.5 rounded-full border border-line-strong" />
            <span className="size-2.5 rounded-full bg-fg/80" />
          </span>
          <span className="truncate font-mono text-[0.72rem] text-muted" dir="ltr">{file}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint sm:inline">{lang}</span>
          <CopyButton text={code} />
        </span>
      </figcaption>
      <p className="border-b border-line px-4 py-2.5 text-[0.82rem] text-fg-2">{title}</p>
      <pre className="code overflow-x-auto px-0 py-4" dir="ltr" data-lenis-prevent-wheel>
        <code className="grid">
          {lines.map((l, i) => (
            <span key={i} className="grid grid-cols-[3.2rem_1fr] hover:bg-fg/[0.04]">
              <span className="select-none pe-4 text-end text-faint/70">{i + 1}</span>
              <span className="pe-6 whitespace-pre" dangerouslySetInnerHTML={{ __html: l || " " }} />
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
