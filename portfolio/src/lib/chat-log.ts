import "server-only";
import { env } from "@/lib/env";
import { allow } from "@/lib/rate-limit";
import { addComment, assertPrivateRepo, createIssue, listComments, listIssues } from "@/lib/github";
import { parseUnanswered, unansweredComment, UNANSWERED_LABEL, type Unanswered } from "@/lib/unanswered";

/**
 * Only the questions the assistant could not answer are kept (no full chat logs): each one is a comment on a single
 * issue labelled "assistant-unanswered" in the data repository, so Taha can turn them into knowledge.
 */
let issueNumber: number | null = null;

async function unansweredIssue(create: boolean): Promise<number | null> {
  if (issueNumber) return issueNumber;
  const [open] = await listIssues({ labels: UNANSWERED_LABEL, state: "open", perPage: 1 });
  if (open) return (issueNumber = open.number);
  if (!create) return null;
  const made = await createIssue({
    title: "پرسش‌های بی‌پاسخ دستیار سایت",
    body: "هر دیدگاه این issue پرسشی است که دستیار سایت پاسخش را در دانش خود نداشت. پاسخ درست را در پنل سایت → «دانش دستیار» (یا فایل knowledge.md همین مخزن) اضافه کنید.",
    labels: [UNANSWERED_LABEL],
  });
  return (issueNumber = made.number);
}

export async function logUnanswered(q: Omit<Unanswered, "at">): Promise<void> {
  // a ceiling per instance, well under GitHub's limits on creating content
  if (!(await allow("unanswered:log", 3600, 30))) return;
  try {
    await assertPrivateRepo();
    const n = await unansweredIssue(true);
    if (n) await addComment(n, unansweredComment({ ...q, at: new Date().toISOString() }));
  } catch (e) {
    issueNumber = null;
    console.error("[unanswered] not logged", e instanceof Error ? e.message : e);
  }
}

/** Newest first. */
export async function listUnanswered(): Promise<{ items: Unanswered[]; url: string | null }> {
  const n = await unansweredIssue(false);
  if (!n) return { items: [], url: null };
  const comments = await listComments(n);
  return { items: comments.map((c) => parseUnanswered(c.body)).filter((x): x is Unanswered => x !== null).reverse(), url: `https://github.com/${env.githubRepo}/issues/${n}` };
}
