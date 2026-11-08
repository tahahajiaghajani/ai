// Pure logic of knowledge management (src/shared/knowledge/logic.ts): headings and anchors, template sections and
// skeletons, blocks, images and links, the sensitive-data scan, unsafe commands, the quality rubric, line diffs,
// similarity, version numbers, the health score and next action, the AQI score, the KCS draft of a record, query
// parsing, highlights and excerpts.
import { describe, it, expect } from "vitest";
import {
  aqiScore, blockRefs, captureDraft, cleanSections, contentHash, diffStats, excerpt, headings, highlightRanges, imageRefs, isInternalArticle, jaccard, lineDiff, linkRefs, missingSections, nextVersion,
  parseQuery, plainText, qualityChecks, redactSensitive, scanSensitive, scrubPeople, sectionsProblem, shingles, similarity, slugify, templateSkeleton, unsafeCommands, wordCount, healthScore,
} from "@shared/knowledge/logic";
import { searchForm } from "@shared/ai/text";

describe("structure", () => {
  it("anchors headings uniquely, Persian kept, code ignored", () => {
    const md = "# نصب\n\n## گام‌ها\n\n```\n## نه این\n```\n\n## گام‌ها\n\n### پرسش‌های رایج\n";
    const h = headings(md);
    expect(h.map((x) => x.text)).toEqual(["نصب", "گام‌ها", "گام‌ها", "پرسش‌های رایج"]);
    expect(new Set(h.map((x) => x.slug)).size).toBe(4);
    expect(h[2].slug).toBe(`${h[1].slug}-2`);
    expect(slugify("**VPN** و  شبکه")).toBe("vpn-و-شبکه");
  });

  it("template sections: cleaned, problems named, skeleton and what is still empty", () => {
    const sections = cleanSections([{ key: "issue", label: "مسئله", required: true }, { key: "cause", label: "علت", internal: true }, { label: "بی‌کلید" }, null]);
    expect(sections.map((s) => s.key)).toEqual(["issue", "cause", "بی-کلید"]); // a missing key comes from the label
    expect(sectionsProblem([{ key: "a" }])).toBeTruthy(); // a section without a label
    expect(sectionsProblem("x")).toBeTruthy();
    expect(sectionsProblem([{ key: "a", label: "الف" }])).toBeNull();
    expect(cleanSections([{ key: "a", label: "الف" }, { key: "a", label: "ب" }]).map((x) => x.key)).toEqual(["a", "a_"]); // keys made unique
    const sk = templateSkeleton(sections);
    expect(sk.body).toContain("## مسئله");
    expect(sk.internal).toContain("## علت");
    expect(missingSections(sections, sk.body, sk.internal).map((s) => s.key)).toEqual(["issue"]);
    expect(missingSections(sections, "## مسئله\n\nچاپ متوقف است\n", "")).toEqual([]);
  });

  it("blocks, images and links of a text", () => {
    expect(blockRefs("پیش {{block:KBB000012}} و {{ block : kbb-7 }}")).toEqual(["KBB000012", "KBB7"]);
    const imgs = imageRefs("![نمای پنجره](attachment:0190a8a2-1111-7000-8000-000000000001) ![](https://x.example/a.png)");
    expect(imgs[0].attachment).toBe("0190a8a2-1111-7000-8000-000000000001");
    expect(imgs[1].attachment).toBeNull();
    const l = linkRefs("ببینید KB12 و kb-000034 و https://intranet.example/a.");
    expect(l.articles).toEqual(["KB000012", "KB000034"]);
    expect(l.urls).toEqual(["https://intranet.example/a"]);
    expect(wordCount("## گام‌ها\n\n1. **دو** واژه")).toBe(3);
    expect(plainText("**پررنگ** و [پیوند](https://a.b)")).toBe("پررنگ و پیوند");
  });

  it("an article is internal when chosen, not yet validated (KCS) or a runbook", () => {
    expect(isInternalArticle({ visibility: "internal" })).toBe(true);
    expect(isInternalArticle({ kcs_confidence: "wip" })).toBe(true);
    expect(isInternalArticle({ kcs_confidence: "validated", visibility: "inherit", article_type: "how_to" })).toBe(false);
  });
});

describe("guards of publication", () => {
  it("finds personal data and credentials (Persian digits too) and redacts them", () => {
    const text = "تماس: ۰۹۱۲۱۲۳۴۵۶۷ و ali@example.com؛ password: Secr3t!! سرور 10.20.30.40 و srv01.corp";
    const f = scanSensitive(text);
    expect(f.map((x) => x.kind).sort()).toEqual(["email", "hostname", "ip", "mobile", "secret"].sort());
    const r = redactSensitive(text, f);
    expect(r).not.toContain("ali@example.com");
    expect(r).not.toContain("Secr3t");
    expect(scanSensitive("کد ملی 0012345678 نادرست است").length).toBe(0); // checksum fails
  });

  it("names unsafe commands", () => {
    expect(unsafeCommands("```\nrm -rf /var/lib\n```").length).toBe(1);
    expect(unsafeCommands("format C: را نزنید").length).toBeGreaterThan(0);
    expect(unsafeCommands("ipconfig /all")).toEqual([]);
  });

  it("scores the rubric; required sections and sensitive data block", () => {
    const sections = cleanSections([{ key: "steps", label: "گام‌ها", required: true }]);
    const bad = qualityChecks({ title: "x", body: "", sections, external: true });
    expect(bad.blocking.length).toBeGreaterThan(0);
    const good = qualityChecks({ title: "اتصال به وای‌فای مهمان", summary: "رمز روزانهٔ شبکهٔ بی‌سیم مهمانان", body: "## گام‌ها\n\n1. شبکهٔ Guest را انتخاب کنید\n2. رمز روزانه را از پذیرش بگیرید\n", keywords: ["وای‌فای"], sections, external: true });
    expect(good.blocking).toEqual([]);
    expect(good.score).toBeGreaterThan(bad.score);
    const leaky = qualityChecks({ title: "تماس با پشتیبانی", summary: "شمارهٔ کارشناس", body: "## گام‌ها\n\n1. با 09121234567 تماس بگیرید\n", sections, external: true });
    expect(leaky.findings.length).toBe(1);
    // the internal part does not count for requesters
    expect(qualityChecks({ title: "سرور", body: "## گام‌ها\n\n1. وارد شوید\n", internal_body: "سرور 10.1.2.3 است", sections, external: true }).findings).toEqual([]);
  });
});

describe("versions and similarity", () => {
  it("numbers versions: drafts of an unpublished article stay 1.0, then minor and major steps", () => {
    expect(nextVersion(0, 0, "minor", false).label).toBe("1.0");
    expect(nextVersion(1, 0, "minor", true).label).toBe("1.1");
    expect(nextVersion(1, 3, "major", true).label).toBe("2.0");
  });

  it("diffs lines and counts changes", () => {
    const d = lineDiff("الف\nب\nج", "الف\nب‌تازه\nج\nد");
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    expect(d.filter((l) => l.op === "same").map((l) => l.text)).toEqual(["الف", "ج"]);
  });

  it("content hash ignores nothing that matters", () => {
    const a = contentHash({ title: "t", body: "b" });
    expect(contentHash({ title: "t", body: "b" })).toBe(a);
    expect(contentHash({ title: "t", body: "b2" })).not.toBe(a);
  });

  it("near-duplicates are similar, unrelated texts are not", () => {
    const x = { title: "تنظیم ایمیل در گوشی اندروید", body: "برنامهٔ ایمیل را باز کنید و حساب تازه بسازید و نشانی سرور را بنویسید" };
    const y = { title: "تنظیم ایمیل روی گوشی اندروید", body: "برنامهٔ ایمیل را باز کنید و حساب تازه بسازید و نشانی سرور را بنویسید" };
    const z = { title: "رزرو اتاق جلسه", body: "تقویم را باز کنید و اتاق خالی را انتخاب کنید" };
    expect(similarity(x, y)).toBeGreaterThan(60); // percent
    expect(similarity(x, z)).toBeLessThan(20);
    expect(jaccard(shingles("الف ب ج د"), shingles("الف ب ج د"))).toBe(1);
  });
});

describe("health, AQI and capture", () => {
  const healthy = { daysToExpiry: 200, daysPastReview: -60, helpfulYes: 20, helpfulNo: 1, views90: 300, reuse90: 12, openFlags: 0, duplicate: false, aqi: 90, quality: 85, translationStale: false, daysSinceUse: 3 };
  it("a fresh, used, liked article is healthy and needs nothing", () => {
    const h = healthScore(healthy);
    expect(h.score).toBeGreaterThanOrEqual(80);
    expect(h.next_action).toBe("none");
  });
  it("names the next action: review, update, merge, retire, translate", () => {
    expect(healthScore({ ...healthy, daysPastReview: 40 }).next_action).toBe("review");
    expect(healthScore({ ...healthy, openFlags: 3, helpfulYes: 1, helpfulNo: 9 }).next_action).toBe("update");
    expect(healthScore({ ...healthy, duplicate: true }).next_action).toBe("merge");
    expect(healthScore({ ...healthy, daysToExpiry: -10, views90: 0, reuse90: 0, daysSinceUse: 400 }).next_action).toBe("retire");
    expect(healthScore({ ...healthy, translationStale: true }).next_action).toBe("translate");
  });
  it("AQI: 100 less the points of the failed checklist items", () => {
    const items = [{ key: "a", weight: 50 }, { key: "b", weight: 25 }, { key: "c", weight: 25 }];
    expect(aqiScore({ a: true, b: true, c: false }, items)).toBe(75);
    expect(aqiScore({}, items)).toBe(100); // nothing marked failed
    expect(aqiScore({ a: false, b: false, c: false }, items)).toBe(0);
  });
  it("a KCS draft from a resolved record: issue, environment, resolution, cause; the workaround internal; people scrubbed", () => {
    const d = captureDraft({ table: "incident", number: "INC0000012", title: "چاپگر کاغذ گیر می‌اندازد", description: "از صبح کاغذ گیر می‌کند", resolution: "غلتک را تمیز کردیم", workaround: "از چاپگر طبقهٔ دوم استفاده کنید", cause: "غلتک کثیف", environment: ["خدمت: چاپ"] });
    expect(headings(d.body).map((h) => h.text)).toEqual(["مسئله", "محیط", "راه‌حل", "علت"]);
    expect(d.body).toContain("غلتک را تمیز کردیم");
    expect(d.body).toContain("خدمت: چاپ");
    expect(d.body).toContain("غلتک کثیف");
    expect(d.internal_body).toContain("از چاپگر طبقهٔ دوم استفاده کنید");
    expect(d.summary).toBe("از صبح کاغذ گیر می‌کند");
    expect(d.title).toBe("چاپگر کاغذ گیر می‌اندازد");
    expect(scrubPeople("علی رضایی گفت با 09121234567 تماس بگیرید", ["علی رضایی"])).not.toMatch(/علی رضایی|09121234567/);
  });
});

describe("queries, highlights and excerpts", () => {
  it("splits terms and quoted phrases in search form", () => {
    const p = parseQuery("نصب \"چاپگر شبکه\" در ويندوز");
    expect(p.phrases).toEqual([searchForm("چاپگر شبکه")]);
    expect(p.terms).toContain(searchForm("نصب"));
    expect(p.terms.some((t) => t.startsWith(searchForm("ویندوز").slice(0, 4)))).toBe(true);
  });
  it("highlights whole words and cuts an excerpt around the first match", () => {
    const text = `${"کلمه ".repeat(80)}چاپگر طبقهٔ سوم ${"دیگر ".repeat(80)}`;
    const r = highlightRanges("چاپگر طبقه", [searchForm("چاپگر")]);
    expect(r).toEqual([[0, 5]]);
    const e = excerpt(text, [searchForm("چاپگر")], 120);
    expect(e).toContain("چاپگر");
    expect(e.startsWith("…")).toBe(true);
    expect(e.length).toBeLessThanOrEqual(126);
  });
});
