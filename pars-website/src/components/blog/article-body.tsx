import { Fragment, type ReactNode } from "react";
import { textDir } from "@/components/chat/markdown";
import { latinDigits } from "@/lib/digits";

/**
 * Markdown for blog articles: ## / ### headings (with anchors), paragraphs, "-" and "1." lists,
 * > quotes, ``` code blocks, --- rules, ![images](https://…), **bold**, *italic*, `code` and links.
 * Builds React elements only (never HTML strings), so stored text cannot inject markup.
 */

const INLINE = /(\*\*[^*]+\*\*|(`+)[^`]+?\2|\[[^\]]+\]\((?:https?:\/\/|mailto:|\/)[^)\s]+\)|\*[^*\s][^*]*\*)/g;
/** Latin, Persian and Arabic-Indic digits (Persian lists are often numbered ۱. ۲. ۳.) */
const D = "[0-9۰-۹٠-٩]";
/** A fence line is ``` plus an optional language, never a line like ```code``` (inline code). */
const FENCE = /^```[^`]*$/;
const ITEM = new RegExp(`^([-*]|${D}+[.)])\\s+`);
/** Lines that end a paragraph because they start another block. */
const BLOCK_START = new RegExp(`^(#{2,4}\\s|\`\`\`[^\`]*$|>|[-*]\\s|${D}+[.)]\\s|!\\[|-{3,}$|\\*{3,}$)`);

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="ltr rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.9em]">{t.slice(m[2].length, -m[2].length)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      const url = t.slice(t.indexOf("(") + 1, -1);
      const external = /^https?:/.test(url);
      out.push(
        <a key={k} href={url} className="text-violet underline underline-offset-4 hover:text-fg" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Anchor id for a heading (Persian letters allowed). */
export function anchor(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Heading text without markdown: links keep their label, emphasis and code marks go. */
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "");

/** Unique heading ids in document order; the "h-" prefix keeps them clear of page ids such as #main. */
function headingIds() {
  const used = new Set<string>();
  return (text: string) => {
    const base = `h-${anchor(plain(text)) || "section"}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

export type Heading = { id: string; text: string; level: 2 | 3 };

/** The ## / ### headings, for a table of contents (ids match the ones ArticleBody renders). */
export function headings(body: string): Heading[] {
  const out: Heading[] = [];
  const idFor = headingIds();
  let fence = false;
  for (const l of body.replace(/\r/g, "").split("\n")) {
    if (FENCE.test(l.trim())) fence = !fence;
    const m = !fence && /^(#{2,4})\s+(.+)$/.exec(l.trim());
    if (!m) continue;
    const id = idFor(m[2]);
    if (m[1].length <= 3) out.push({ id, text: plain(m[2]), level: m[1].length as 2 | 3 });
  }
  return out;
}

export function ArticleBody({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const src = text.replace(/\r/g, "").split("\n");
  const idFor = headingIds();
  let i = 0;
  let b = 0;
  while (i < src.length) {
    const line = src[i];
    const t = line.trim();
    const key = `b${b++}`;
    if (!t) {
      i++;
      continue;
    }
    if (FENCE.test(t)) {
      const code: string[] = [];
      i++;
      while (i < src.length && !FENCE.test(src[i].trim())) code.push(src[i++]);
      i++;
      blocks.push(
        <pre key={key} dir="ltr" className="scroll-thin overflow-x-auto rounded-2xl border border-line bg-ink-2 p-4 text-[13px] leading-6 text-muted">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{2,4})\s+(.+)$/.exec(t);
    if (h) {
      const level = Math.min(h[1].length, 3);
      const Tag = level === 2 ? "h2" : "h3";
      blocks.push(
        <Tag key={key} id={idFor(h[2])} dir={textDir(h[2])} className={`scroll-mt-28 font-semibold text-fg ${level === 2 ? "mt-12 text-[1.35rem] leading-9" : "mt-8 text-lg leading-8"}`}>
          {inline(h[2], key)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push(<hr key={key} className="hairline my-10 border-0" />);
      i++;
      continue;
    }
    const img = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.exec(t);
    if (img) {
      blocks.push(
        <figure key={key} className="my-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-provided remote images of unknown size */}
          <img src={img[2]} alt={img[1]} loading="lazy" decoding="async" className="w-full rounded-2xl border border-line" />
          {img[1] && <figcaption className="mt-2 text-center text-xs text-faint">{img[1]}</figcaption>}
        </figure>,
      );
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      const q: string[] = [];
      while (i < src.length && src[i].trim().startsWith(">")) q.push(src[i++].trim().replace(/^>\s?/, ""));
      const joined = q.join(" ");
      blocks.push(
        <blockquote key={key} dir={textDir(joined)} className="justified my-6 border-s-2 border-pink/60 ps-5 text-[1.05rem] leading-9 text-fg/90">
          {inline(joined, key)}
        </blockquote>,
      );
      continue;
    }
    if (ITEM.test(t)) {
      const ordered = /^[-*]/.test(t) ? null : parseInt(latinDigits(t), 10);
      const items: string[] = [];
      while (i < src.length && ITEM.test(src[i].trim())) items.push(src[i++].trim().replace(ITEM, ""));
      const List = ordered === null ? "ul" : "ol";
      const dir = textDir(items.join(" "));
      // numbered lists keep their first number (e.g. a list split by a blank line) and use Persian numerals in rtl text
      const style = ordered === null ? "list-disc" : dir === "rtl" ? "list-[persian]" : "list-decimal";
      blocks.push(
        <List key={key} start={ordered !== null && ordered !== 1 ? ordered : undefined} dir={dir} className={`justified my-5 space-y-2 ps-6 marker:text-pink ${style}`}>
          {items.map((it, j) => (
            <li key={j} className="ps-1">
              {inline(it, `${key}-${j}`)}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    // the first line always belongs to the paragraph (e.g. an image line that is not https), so the loop advances
    const para: string[] = [t];
    i++;
    while (i < src.length && src[i].trim() && !BLOCK_START.test(src[i].trim())) para.push(src[i++].trim());
    const joined = para.join(" ");
    blocks.push(
      <p key={key} dir={textDir(joined)} className="justified my-5">
        {inline(joined, key)}
      </p>,
    );
  }
  return <Fragment>{blocks}</Fragment>;
}
