import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown for assistant answers and ticket messages: paragraphs, **bold**,
 * *italic*, `code`, [links](https://…), "-"/"1." lists and ### headings. Builds React elements
 * (never HTML strings), so model output cannot inject markup.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:|tel:|\/)[^)\s]+\)|\*[^*\s][^*]*\*)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="ltr">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      const url = t.slice(t.indexOf("(") + 1, -1);
      const external = /^https?:/.test(url);
      out.push(
        <a key={k} href={url} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(text: string, key: string): ReactNode[] {
  return text.split("\n").flatMap((l, i, arr) => [<Fragment key={`${key}-l${i}`}>{inline(l, `${key}-${i}`)}</Fragment>, i < arr.length - 1 ? <br key={`${key}-br${i}`} /> : null]);
}

export function Markdown({ text, className = "prose-chat" }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const src = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let b = 0;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push(<h4 key={b++}>{inline(heading[1], `h${b}`)}</h4>);
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < src.length && !/^```/.test(src[i])) code.push(src[i++]);
      i++;
      blocks.push(
        <pre key={b++} className="ltr my-2 overflow-x-auto rounded-xl bg-black/30 p-3 text-[0.85em]">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const isUl = (l: string) => /^\s*[-*•]\s+/.test(l);
    const isOl = (l: string) => /^\s*[\d۰-۹]+[.)]\s+/.test(l);
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items: string[] = [];
      while (i < src.length && (ordered ? isOl(src[i]) : isUl(src[i]))) {
        items.push(src[i].replace(ordered ? /^\s*[\d۰-۹]+[.)]\s+/ : /^\s*[-*•]\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={b++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${b}-${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < src.length && src[i].trim() && !isUl(src[i]) && !isOl(src[i]) && !/^#{1,6}\s/.test(src[i]) && !/^```/.test(src[i])) para.push(src[i++]);
    blocks.push(
      <p key={b++} dir="auto">
        {lines(para.join("\n"), `p${b}`)}
      </p>,
    );
  }
  return <div className={className}>{blocks}</div>;
}
