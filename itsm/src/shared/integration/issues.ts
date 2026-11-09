// Jira and GitHub issue sync (catalogue INT-026, INT-028): the shapes both tools send and expect, pure. The server
// creates an issue from a record, keeps its key on an `external_ref`, and turns the tools' webhooks into notes (and an
// optional state change) on the record — as the connection's integration user, never as the system.
// Imported by the UI: keep it free of server imports.

export type IssueKind = "github" | "jira";

export interface IssueEvent {
  action: "closed" | "reopened" | "commented" | "updated" | "ignored";
  /** «#12» (GitHub) or «OPS-7» (Jira) */
  remote_key: string;
  remote_id?: string | null;
  /** the repository of a GitHub event («owner/name») */
  repo?: string | null;
  state?: string | null;
  url?: string | null;
  comment?: { id: string; body: string; author: string } | null;
  /** the sender's account (to skip what this connection itself wrote) */
  actor?: string | null;
}

const s = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** A GitHub webhook (`X-GitHub-Event` + body) as an issue event. */
export function githubEvent(event: string, body: any): IssueEvent {
  const issue = body?.issue;
  if (!issue || typeof issue !== "object") return { action: "ignored", remote_key: "" };
  const key = `#${s(issue.number)}`;
  const base = { remote_key: key, remote_id: s(issue.id) || null, repo: s(body?.repository?.full_name) || null, state: s(issue.state) || null, url: s(issue.html_url) || null, actor: s(body?.sender?.login) || null };
  if (event === "issue_comment" && body?.action === "created" && body?.comment) {
    return { ...base, action: "commented", comment: { id: s(body.comment.id), body: s(body.comment.body), author: s(body.comment.user?.login) } };
  }
  if (event === "issues") {
    if (body?.action === "closed") return { ...base, action: "closed" };
    if (body?.action === "reopened") return { ...base, action: "reopened" };
    if (body?.action === "edited" || body?.action === "labeled" || body?.action === "assigned") return { ...base, action: "updated" };
  }
  return { ...base, action: "ignored" };
}

/** A Jira Cloud webhook (`webhookEvent` + issue / comment) as an issue event. */
export function jiraEvent(body: any): IssueEvent {
  const issue = body?.issue;
  if (!issue || typeof issue !== "object") return { action: "ignored", remote_key: "" };
  const status = issue.fields?.status;
  const category = s(status?.statusCategory?.key);
  const base = { remote_key: s(issue.key), remote_id: s(issue.id) || null, state: s(status?.name) || null, url: null, actor: s(body?.user?.accountId ?? body?.comment?.author?.accountId) || null };
  const ev = s(body?.webhookEvent);
  if (ev === "comment_created" && body?.comment) {
    return { ...base, action: "commented", comment: { id: s(body.comment.id), body: adfToText(body.comment.body), author: s(body.comment.author?.displayName) } };
  }
  if (ev === "jira:issue_updated") {
    const items: any[] = Array.isArray(body?.changelog?.items) ? body.changelog.items : [];
    const statusChange = items.find((i) => s(i.field).toLowerCase() === "status");
    if (statusChange) return { ...base, action: category === "done" ? "closed" : "reopened" };
    return { ...base, action: "updated" };
  }
  return { ...base, action: "ignored" };
}

/** Is a remote state closed? (GitHub «closed»; Jira's status category «done» or a common done name.) */
export function isClosedState(kind: IssueKind, state: string | null | undefined, category?: string | null): boolean {
  if (kind === "github") return String(state ?? "").toLowerCase() === "closed";
  if (category) return category === "done";
  return /^(done|closed|resolved|انجام|بسته|حل)/i.test(String(state ?? "").trim());
}

/** Plain text → the Atlassian Document Format Jira Cloud's REST API v3 expects. */
export function adfDoc(text: string): Record<string, unknown> {
  const paras = String(text ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "doc",
    version: 1,
    content: (paras.length ? paras : [""]).map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] })),
  };
}

/** The text of an ADF document (or a plain string). */
export function adfToText(doc: unknown): string {
  if (typeof doc === "string") return doc;
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    if (Array.isArray(n.content)) {
      for (const c of n.content) walk(c);
      if (n.type === "paragraph") out.push("\n");
    }
  };
  walk(doc);
  return out.join("").replace(/\n+$/, "").trim();
}

/** The issue's title and body made from a record (only what the acting member may read reaches it). */
export function issueText(r: { number: string | null; title: string; description: string | null; url: string; table_label: string }): { title: string; body: string } {
  const title = `${r.number ? `${r.number} — ` : ""}${r.title}`.slice(0, 250);
  const body = [`${r.table_label}: ${r.number ?? ""}`.trim(), r.description?.trim() || null, `پیوند: ${r.url}`].filter(Boolean).join("\n\n");
  return { title, body };
}

/** A note on the record about a remote event (Persian). */
export function noteOf(kind: IssueKind, e: IssueEvent): string | null {
  const tool = kind === "github" ? "GitHub" : "Jira";
  switch (e.action) {
    case "closed":
      return `issue ${e.remote_key} در ${tool} بسته شد${e.state ? ` (${e.state})` : ""}.`;
    case "reopened":
      return `issue ${e.remote_key} در ${tool} دوباره باز شد${e.state ? ` (${e.state})` : ""}.`;
    case "commented":
      return e.comment ? `یادداشت ${e.comment.author || "کاربر"} در ${tool} (${e.remote_key}):\n\n${e.comment.body.slice(0, 5000)}` : null;
    default:
      return null;
  }
}
