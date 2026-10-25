/**
 * knowledge.md in the data repository: extra facts for the assistant, editable in the panel or straight on GitHub
 * (pure, unit-tested). Each fact starts with a "## title" line; an optional "tags:" line follows; the rest is the text.
 */

export interface Fact {
  title: string;
  tags: string[];
  body: string;
}

export const KNOWLEDGE_FILE = "knowledge.md";

const HEADER = `# دانش اضافه‌ی دستیار سایت

<!-- هر نکته با «## عنوان» شروع می‌شود؛ خط «tags:» اختیاری است و بقیه متن نکته است. محتوای خود سایت (پروفایل، پروژه‌ها، سوابق) همیشه جزو دانش دستیار است؛ اینجا فقط چیزهای بیشتر بنویسید. پس از ویرایش همین فایل، در پنل سایت → «دانش دستیار» دکمه‌ی «تازه‌سازی از GitHub» را بزنید (وگرنه چند دقیقه طول می‌کشد). -->
`;

export function parseKnowledgeFile(text: string): Fact[] {
  const out: Fact[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    let lines = cur.lines;
    let tags: string[] = [];
    const first = lines.findIndex((l) => l.trim() !== "");
    if (first >= 0 && /^tags\s*:/i.test(lines[first].trim())) {
      tags = lines[first]
        .trim()
        .replace(/^tags\s*:/i, "")
        .split(/[,،]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12);
      lines = lines.slice(first + 1);
    }
    const body = lines.join("\n").trim();
    if (cur.title && body) out.push({ title: cur.title, tags, body });
  };
  for (const line of text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      cur = { title: h[1].slice(0, 200), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  flush();
  return out;
}

export function serializeKnowledgeFile(facts: Fact[]): string {
  const blocks = facts.map((f) => [`## ${f.title.replace(/\s*\n\s*/g, " ").trim()}`, ...(f.tags.length ? [`tags: ${f.tags.join(", ")}`] : []), f.body.trim()].join("\n"));
  return `${HEADER}${blocks.length ? `\n${blocks.join("\n\n")}\n` : ""}`;
}
