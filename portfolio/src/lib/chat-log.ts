import "server-only";
import { env } from "@/lib/env";
import { allow } from "@/lib/rate-limit";
import { addComment, createIssue, listIssues, listRecentComments, updateIssue } from "@/lib/github";
import { parseUnanswered, unansweredComment, UNANSWERED_LABEL, type Unanswered } from "@/lib/unanswered";

/**
 * Only the questions the assistant could not answer are kept (no full chat logs): each one is a comment on a single
 * open issue labelled "assistant-unanswered" in the data repository, so Taha can turn them into knowledge. When that
 * issue grows large it is closed and a fresh one is started.
 */
const ROTATE_AT = 1500;
let cached: { number: number; at: number } | null = null;
let pending: Promise<number | null> | null = null;

async function findOrCreate(create: boolean): Promise<number | null> {
  const [open] = await listIssues({ labels: UNANSWERED_LABEL, state: "open", perPage: 1 });
  if (open && open.comments < ROTATE_AT) return open.number;
  if (!create) return open?.number ?? null;
  const made = await createIssue({
    title: "پرسش‌های بی‌پاسخ دستیار سایت",
    body: "هر دیدگاه این issue پرسشی است که دستیار سایت پاسخش را در دانش خود نداشت. پاسخ درست را در پنل سایت → «دانش دستیار» (یا فایل knowledge.md همین مخزن) اضافه کنید.",
    labels: [UNANSWERED_LABEL],
  });
  if (open) await updateIssue(open.number, { state: "closed" }).catch(() => {});
  return made.number;
}

/** The open issue for unanswered questions; remembered for ten minutes, and found or created only once at a time. */
export async function unansweredIssue(create: boolean): Promise<number | null> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.number;
  if (!pending) {
    pending = findOrCreate(create)
      .then((n) => {
        cached = n ? { number: n, at: Date.now() } : null;
        return n;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export async function logUnanswered(q: Omit<Unanswered, "at">): Promise<void> {
  // a ceiling per instance, well under GitHub's limits on creating content
  if (!(await allow("unanswered:log", 3600, 30))) return;
  try {
    const n = await unansweredIssue(true);
    if (n) await addComment(n, unansweredComment({ ...q, at: new Date().toISOString() }));
  } catch (e) {
    cached = null;
    console.error("[unanswered] not logged", e instanceof Error ? e.message : e);
  }
}

/**
 * The newest 100, newest first. Right after a rotation the open issue holds only a few, so the rest come from the
 * issue before it (closed, but its questions may still be unhandled).
 */
export async function listUnanswered(): Promise<{ items: Unanswered[]; url: string | null; previousUrl: string | null }> {
  const [current, previous] = await listIssues({ labels: UNANSWERED_LABEL, state: "all", perPage: 2 });
  if (!current) return { items: [], url: null, previousUrl: null };
  const read = async (n: number, max: number) => (await listRecentComments(n, max)).map((c) => parseUnanswered(c.body)).filter((x): x is Unanswered => x !== null);
  const now = await read(current.number, 100);
  const before = previous && now.length < 100 ? await read(previous.number, 100 - now.length) : [];
  const link = (n: number) => `https://github.com/${env.githubRepo}/issues/${n}`;
  return { items: [...before, ...now].reverse(), url: link(current.number), previousUrl: previous ? link(previous.number) : null };
}
