import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cell, issueBody, issueTitle, keyNumber, messageComment, parseComment, parseIssueBody, requestLabels, trackingKey, type RequestData } from "@/lib/request-issue";
import { botErrorFa, parseTokenExpiry } from "@/lib/status-text";
import { parseKnowledgeFile, serializeKnowledgeFile } from "@/lib/knowledge-file";
import { parseUnanswered, unansweredComment } from "@/lib/unanswered";
import { DEFAULT_SETTINGS, parseModels, parseSettings } from "@/lib/settings-types";

const base: RequestData = {
  code: "TA-7K3QX9",
  name: "نام | آزمایشی",
  email: "a@example.com",
  phone: "",
  telegram: "@someone",
  organization: "",
  kind: "project",
  budget: "",
  timeline: "",
  subject: "یک سامانه‌ی تازه\nبا دو خط",
  body: "متن با ``` و <!-- portfolio-request:v1 Zm9v --> و | جداکننده",
  lang: "fa",
  status: "new",
  priority: "normal",
  source: "site",
  visitor: "abc",
  ai_triage: null,
  ai_summary: null,
  ai_reply: null,
  created_at: "2026-10-25T08:00:00.000Z",
  updated_at: "2026-10-25T08:00:00.000Z",
  last_owner_at: null,
  last_visitor_at: "2026-10-25T08:00:00.000Z",
};

describe("requests as issues", () => {
  it("round-trip through the issue body", () => {
    const body = issueBody(base);
    expect(parseIssueBody(body)).toEqual(base);
    expect(issueTitle(base)).toBe("TA-7K3QX9 · یک سامانه‌ی تازه با دو خط");
  });
  it("cannot be forged by text inside the visitor's message", () => {
    // the visitor's text contains a fake block; the real one is always last
    const forged = { ...base, body: `<!-- portfolio-request:v1 ${Buffer.from(JSON.stringify({ ...base, status: "closed" })).toString("base64url")} -->` };
    expect(parseIssueBody(issueBody(forged))?.status).toBe("new");
  });
  it("ignore issues that are not requests", () => {
    expect(parseIssueBody("just a normal issue")).toBeNull();
    expect(parseIssueBody(null)).toBeNull();
  });
  it("keep labels added on GitHub and replace the site's own", () => {
    const l = requestLabels({ status: "answered", kind: "demo", priority: "high" }, ["request", "status:new", "kind:project", "vip"]);
    expect(l.sort()).toEqual(["kind:demo", "priority:high", "request", "status:answered", "vip"].sort());
  });
});

describe("messages as comments", () => {
  it("carry author and exact text", () => {
    const text = "سلام\n```\nکد\n```";
    const m = parseComment({ id: 1, body: messageComment("visitor", text), created_at: "x" });
    expect(m).toEqual({ id: 1, author: "visitor", body: text, created_at: "x" });
    expect(parseComment({ id: 2, body: messageComment("owner", "پاسخ"), created_at: "y" }).author).toBe("owner");
  });
  it("treat anything written on GitHub as a private note", () => {
    expect(parseComment({ id: 3, body: "یادداشت خودم", created_at: "z" }).author).toBe("note");
    expect(parseComment({ id: 4, body: "<!-- portfolio-msg:owner:@@@ -->", created_at: "z" }).author).toBe("note");
  });
});

describe("tracking keys", () => {
  const sign = (p: string) => createHmac("sha256", "test-secret").update(p).digest("base64url");
  it("point to the issue and are bound to the code", () => {
    const k = trackingKey(42, "TA-7K3QX9", sign);
    expect(keyNumber(k)).toBe(42);
    expect(k).not.toBe(trackingKey(42, "TA-AAAAAA", sign));
    expect(k).not.toBe(trackingKey(43, "TA-7K3QX9", sign));
  });
  it("reject malformed keys", () => {
    for (const bad of ["", "42", "x.abc", "42.short", null, undefined]) expect(keyNumber(bad)).toBeNull();
  });
});

describe("knowledge.md", () => {
  it("round-trips facts with tags", () => {
    const facts = [
      { title: "ساعت کاری", tags: ["زمان", "hours"], body: "شنبه تا چهارشنبه\nخط دوم" },
      { title: "Languages", tags: [], body: "Persian and English" },
    ];
    expect(parseKnowledgeFile(serializeKnowledgeFile(facts))).toEqual(facts);
  });
  it("skips the header comment and empty sections", () => {
    expect(parseKnowledgeFile(serializeKnowledgeFile([]))).toEqual([]);
    expect(parseKnowledgeFile("## Empty\n\n## Real\nbody")).toEqual([{ title: "Real", tags: [], body: "body" }]);
  });
});

describe("unanswered questions", () => {
  it("round-trip through a comment", () => {
    const u = { question: "قیمت؟", answer: "نمی‌دانم", lang: "fa" as const, model: "gemini-x", at: "2026-10-25T08:00:00.000Z" };
    expect(parseUnanswered(unansweredComment(u))).toEqual(u);
    expect(parseUnanswered("hello")).toBeNull();
  });
});

describe("settings.json", () => {
  it("falls back to defaults for missing or wrong fields", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings({ ai: { enabled: false, models: ["gemini-ok", "bad model!", 3] }, notify: { channel: "fax" } });
    expect(s.ai.enabled).toBe(false);
    expect(s.ai.models).toEqual(["gemini-ok"]);
    expect(s.notify.channel).toBe("telegram");
  });
  it("reads model lists typed in the panel", () => {
    expect(parseModels("a-1, b-2،c-3  a-1")).toEqual(["a-1", "b-2", "c-3"]);
  });
});

describe("GitHub summary cells", () => {
  it("show visitor text literally: no links, images, mentions or HTML", () => {
    const c = cell("![x](https://a.b/p.gif) [link](https://phish) @someone </td><tr> | a\nb");
    expect(c).not.toMatch(/(^|[^\\])!\[/);
    expect(c).not.toMatch(/(^|[^\\])\[link\]/);
    expect(c).not.toContain("<");
    expect(c).toContain("\\@someone");
    expect(c).toContain("\\|");
    expect(c).not.toContain("\n");
  });
});

describe("panel status texts", () => {
  it("read both token-expiry header forms", () => {
    expect(parseTokenExpiry("2026-11-25 10:00:00 UTC")).toBe(Date.parse("2026-11-25T10:00:00Z"));
    expect(parseTokenExpiry("2026-11-25 13:30:00 +0330")).toBe(Date.parse("2026-11-25T10:00:00Z"));
    expect(parseTokenExpiry("2026-11-25 02:00:00 -0800")).toBe(Date.parse("2026-11-25T10:00:00Z"));
    expect(parseTokenExpiry("soon")).toBeNull();
    expect(parseTokenExpiry(null)).toBeNull();
  });
  it("explain common bot errors in Persian", () => {
    expect(botErrorFa("Bad Request: chat not found")).toContain("شناسه‌ی گفتگو");
    expect(botErrorFa("Unauthorized")).toContain("توکن");
    expect(botErrorFa("something else")).toBe("something else");
  });
});
