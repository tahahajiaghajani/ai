/** A question the assistant could not answer, as a comment on the "assistant-unanswered" issue (pure, unit-tested). */

export const UNANSWERED_LABEL = "assistant-unanswered";
const MARK = "portfolio-unanswered:v1";

export interface Unanswered {
  question: string;
  answer: string;
  lang: "fa" | "en";
  model: string;
  at: string;
}

function fenced(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

export function unansweredComment(u: Unanswered): string {
  const data = { ...u, question: u.question.slice(0, 2000), answer: u.answer.slice(0, 3000) };
  return `<!-- ${MARK} ${Buffer.from(JSON.stringify(data), "utf8").toString("base64url")} -->\n**پرسش** (${u.lang === "en" ? "انگلیسی" : "فارسی"})\n\n${fenced(data.question)}\n\n<details><summary>پاسخ دستیار</summary>\n\n${fenced(data.answer)}\n\n</details>`;
}

export function parseUnanswered(body: string | null | undefined): Unanswered | null {
  const m = new RegExp(`^<!-- ${MARK} ([A-Za-z0-9_-]+) -->`).exec(body ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as Partial<Unanswered>;
    if (typeof j.question !== "string") return null;
    return { question: j.question, answer: typeof j.answer === "string" ? j.answer : "", lang: j.lang === "en" ? "en" : "fa", model: typeof j.model === "string" ? j.model : "", at: typeof j.at === "string" ? j.at : "" };
  } catch {
    return null;
  }
}
