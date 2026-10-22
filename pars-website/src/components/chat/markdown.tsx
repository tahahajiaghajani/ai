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

const LETTER = /\p{L}/gu;
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const RTL_LETTER = /(?=\p{L})[\p{Script=Arabic}\p{Script=Hebrew}]/gu;

/**
 * Direction of a block, so an English answer on the Persian page (or the reverse) lines up. A block
 * that starts in Persian/Arabic is RTL, as with dir="auto" (first strong letter), however many English
 * product names follow. Unlike dir="auto", a Persian line that starts with an English term stays RTL
 * once at least a third of its letters are Persian/Arabic. Code, URLs and link targets don't count.
 * Undefined when there are no letters — the block keeps the page direction.
 */
/** The language a direction implies on this site (lets English blocks in Persian posts hyphenate when justified). */
export function langOf(dir: "rtl" | "ltr" | undefined): "fa" | "en" | undefined {
  return dir === "ltr" ? "en" : dir === "rtl" ? "fa" : undefined;
}

export function textDir(text: string): "rtl" | "ltr" | undefined {
  const words = text.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]").replace(/(?:https?:\/\/|mailto:|www\.)\S+/g, "");
  const letters = words.match(LETTER);
  if (!letters) return undefined;
  if (RTL_SCRIPT.test(letters[0])) return "rtl";
  const rtl = words.match(RTL_LETTER)?.length ?? 0;
  return rtl * 3 >= letters.length ? "rtl" : "ltr";
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
      blocks.push(
        <h4 key={b++} dir={textDir(heading[1])}>
          {inline(heading[1], `h${b}`)}
        </h4>,
      );
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
      // on the list, not each item, so the marker side and padding follow the text
      blocks.push(
        <List key={b++} dir={textDir(items.join("\n"))}>
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
      <p key={b++} dir={textDir(para.join("\n"))}>
        {lines(para.join("\n"), `p${b}`)}
      </p>,
    );
  }
  return <div className={className}>{blocks}</div>;
}
