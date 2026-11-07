// The notification service's pure parts: the template language (placeholders, conditionals, Markdown escaping),
// relayed Markdown, preferences (opt-outs, quiet hours across midnight, digest times), mobile numbers and SMS
// segments, address lists, subject number tokens, the strict Markdown → HTML of e-mails, quoted-reply stripping, and
// the requests the messenger, webhook and SMS adapters make.
import { describe, it, expect } from "vitest";
import {
  addressMatches, cleanPrefs, cleanRecipients, escapeMarkdown, eventsOf, hasRecipients, inboxKind, nextDigestAt, normalizeMobile,
  optedOut, parseTemplate, plainLine, quietUntil, relayMarkdown, renderTemplate, smsSegments, subjectNumbers, templatePaths, type TplScope,
} from "@shared/notify";
import { emailLayout, markdownToHtml, markdownToText, withNumber } from "@server/modules/notify/mail";
import { stripQuoted } from "@server/modules/notify/inbound";
import { outsideRequest, smsRequest } from "@server/modules/notify/channels";
import { SMS_PRESETS } from "@shared/notify";
import { APP_NAME } from "@shared/constants";

const scope = (values: Record<string, unknown>): TplScope => ({
  text: (p) => (values[p] === undefined || values[p] === null ? "" : String(values[p])),
  raw: (p) => values[p],
});

describe("template language", () => {
  it("fills placeholders, conditionals and else branches", () => {
    const s = scope({ "record.number": "TODO0000012", state: "resolved", "state.display": "حل‌شده", assigned_to: "", short_description: "چاپگر" });
    expect(renderTemplate("{{record.number}}: {{short_description}}", s)).toBe("TODO0000012: چاپگر");
    expect(renderTemplate("{{#if assigned_to}}دارد{{else}}ندارد{{/if}}", s)).toBe("ندارد");
    expect(renderTemplate('{{#if state == "resolved"}}حل شد{{/if}}', s)).toBe("حل شد");
    expect(renderTemplate("{{#if state != 'resolved'}}باز{{else}}بسته{{/if}}", s)).toBe("بسته");
    expect(renderTemplate("{{#unless assigned_to}}بی‌کارشناس{{/unless}}", s)).toBe("بی‌کارشناس");
    expect(renderTemplate("{{#if state == «حل‌شده»}}با برچسب{{/if}}", s)).toBe("با برچسب");
    expect(renderTemplate("{{#if a}}{{#if b}}هر دو{{else}}فقط الف{{/if}}{{/if}}", scope({ a: "1", b: "" }))).toBe("فقط الف");
  });

  it("reports malformed templates in Persian and lists the paths it reads", () => {
    expect(parseTemplate("{{#if x}}بی‌پایان").error).toMatch(/بسته نشده/);
    expect(parseTemplate("{{/if}}").error).toMatch(/بی‌جفت/);
    expect(parseTemplate("{{else}}").error).toMatch(/بیرون/);
    expect(parseTemplate("{{ bad path! }}").error).toMatch(/معتبر نیست/);
    expect(parseTemplate("{{#if }}x{{/if}}").error).toBeTruthy();
    expect(parseTemplate("سلام {{recipient.name}}").error).toBeNull();
    expect(templatePaths("{{a}} {{#if b.display}}{{c}}{{/if}}", "{{link}}").sort()).toEqual(["a", "b.display", "c", "link"]);
  });

  it("escapes record values in Markdown bodies but keeps what the scope marks as safe", () => {
    const s: TplScope = { ...scope({ t: "[کلیک](http://evil.example) **x**", link: "https://app.example/r/todo/1" }), markdown: (p) => (p === "link" ? "https://app.example/r/todo/1" : null) };
    const out = renderTemplate("{{t}} — [باز کنید]({{link}})", s, "markdown");
    expect(out).toBe("\\[کلیک\\]\\(http://evil.example\\) \\*\\*x\\*\\* — [باز کنید](https://app.example/r/todo/1)");
    expect(markdownToHtml(out)).not.toContain("evil.example\"");
    expect(markdownToHtml(out)).toContain('<a href="https://app.example/r/todo/1"');
    expect(escapeMarkdown("- فهرست\n1. شماره")).toBe("\\- فهرست\n1\\. شماره");
    expect(plainLine("  سلام\n@[سارا](mention:2f0c0000-0000-4000-8000-000000000000)  ")).toBe("سلام @سارا");
  });

  it("relays a person's Markdown without disguised links", () => {
    expect(relayMarkdown("ببینید [اینجا](https://evil.example/x) و @[علی](mention:2f0c0000-0000-4000-8000-000000000000)")).toBe("ببینید اینجا (https://evil.example/x) و **@علی**");
    expect(relayMarkdown("[https://a.example](https://a.example)")).toBe("<https://a.example>");
    expect(relayMarkdown("![نمودار](https://img.example/x.png)")).toBe("[نمودار]");
  });
});

describe("recipients and events", () => {
  it("cleans recipient specs and maps record events", () => {
    const r = cleanRecipients({ assignee: true, watchers: "yes", users: ["2F0C0000-0000-4000-8000-000000000000", "bad"], fields: ["caller_id", "DROP TABLE"], extra: 1 });
    expect(r).toEqual({ assignee: true, users: ["2f0c0000-0000-4000-8000-000000000000"], fields: ["caller_id"] });
    expect(hasRecipients({})).toBe(false);
    expect(eventsOf("record.commented").sort()).toEqual(["commented", "mentioned"]);
    expect(eventsOf("record.sla_breached")).toEqual(["sla_breach"]);
    expect(inboxKind("assigned", ["watchers"])).toBe("watching");
    expect(inboxKind("assigned", ["watchers", "assignee"])).toBe("direct");
    expect(inboxKind("approval_requested", ["event_users"])).toBe("approval");
  });
});

describe("preferences", () => {
  it("cleans stored preferences and answers opt-outs", () => {
    const p = cleanPrefs({ optouts: ["assigned:email", "*:sms", "x:fax", 3], digest: "weekly", digest_hour: 30, quiet_from: "22:00", quiet_to: "7:00" });
    expect(p).toEqual({ optouts: ["assigned:email", "*:sms"], digest: "none", digest_hour: 8, quiet_from: "22:00", quiet_to: "07:00" });
    expect(optedOut(p, "assigned", "email")).toBe(true);
    expect(optedOut(p, "assigned", "in_app")).toBe(false);
    expect(optedOut(p, "commented", "sms")).toBe(true);
  });

  it("holds messages in quiet hours across midnight (Tehran time, no daylight saving)", () => {
    const p = { quiet_from: "22:00", quiet_to: "07:00" };
    // 2026-03-21 23:30 Tehran = 20:00 UTC
    const late = new Date("2026-03-21T20:00:00Z");
    expect(quietUntil(p, late, "Asia/Tehran")?.toISOString()).toBe("2026-03-22T03:30:00.000Z");
    // 06:59 Tehran = 03:29 UTC
    expect(quietUntil(p, new Date("2026-03-22T03:29:00Z"), "Asia/Tehran")?.toISOString()).toBe("2026-03-22T03:30:00.000Z");
    // 07:00 Tehran: over
    expect(quietUntil(p, new Date("2026-03-22T03:30:00Z"), "Asia/Tehran")).toBeNull();
    // midday window
    expect(quietUntil({ quiet_from: "12:00", quiet_to: "13:00" }, new Date("2026-03-22T09:00:00Z"), "Asia/Tehran")?.toISOString()).toBe("2026-03-22T09:30:00.000Z");
    expect(quietUntil({ quiet_from: null, quiet_to: null }, late, "Asia/Tehran")).toBeNull();
  });

  it("schedules digests on the next hour or the chosen local hour", () => {
    const at = new Date("2026-03-21T05:10:00Z"); // 08:40 Tehran
    expect(nextDigestAt("hourly", at, "Asia/Tehran").toISOString()).toBe("2026-03-21T05:30:00.000Z");
    expect(nextDigestAt("daily", at, "Asia/Tehran", 8).toISOString()).toBe("2026-03-22T04:30:00.000Z");
    expect(nextDigestAt("daily", at, "Asia/Tehran", 17).toISOString()).toBe("2026-03-21T13:30:00.000Z");
  });
});

describe("numbers, addresses and subjects", () => {
  it("normalises Iranian mobile numbers and counts SMS segments", () => {
    expect(normalizeMobile("۰۹۱۲ ۳۴۵ ۶۷۸۹")).toBe("989123456789");
    expect(normalizeMobile("+98 912 345 6789")).toBe("989123456789");
    expect(normalizeMobile("9123456789")).toBe("989123456789");
    expect(normalizeMobile("12")).toBeNull();
    expect(smsSegments("سلام")).toBe(1);
    expect(smsSegments("س".repeat(71))).toBe(2);
    expect(smsSegments("a".repeat(160))).toBe(1);
  });

  it("matches addresses and domains and finds record numbers in subjects", () => {
    expect(addressMatches("Ali@Mail.Example.com", ["@example.com"])).toBe(true);
    expect(addressMatches("ali@example.com", ["example.com"])).toBe(true);
    expect(addressMatches("ali@example.com", ["reza@example.com"])).toBe(false);
    expect(addressMatches("ali@notexample.com", ["@example.com"])).toBe(false);
    expect(subjectNumbers("پاسخ: [TODO0000012] چاپگر [INC0000003]")).toEqual(["TODO0000012", "INC0000003"]);
    expect(withNumber("ارجاع کار", "TODO0000012")).toBe("ارجاع کار [TODO0000012]");
    expect(withNumber("[TODO0000012] قبلی", "TODO0000012")).toBe("[TODO0000012] قبلی");
  });
});

describe("e-mail rendering", () => {
  it("renders strict Markdown: escaped HTML, safe links only, lists, quotes and code", () => {
    const html = markdownToHtml("# عنوان\n\nمتن <script>alert(1)</script> **پررنگ** و *کج*\n\n- یک\n- دو\n\n> نقل\n\n`code` [بد](javascript:alert(1)) [خوب](https://ok.example/a_b)\n\n```\n<b>x</b>\n```");
    expect(html).toContain("<h1");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>پررنگ</strong>");
    expect(html).toContain("<em>کج</em>");
    expect(html).toContain("<ul");
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://ok.example/a_b"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(markdownToText("**الف** [ب](https://b.example) \\*")).toBe("الف ب (https://b.example) *");
  });

  it("lays e-mails out right to left with the product name", () => {
    const html = emailLayout({ title: "ارجاع <کار>", bodyHtml: "<p>x</p>", orgName: "سازمان", url: "https://app.example/x", action: "مشاهده", replies: true });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="fa"');
    expect(html).toContain(APP_NAME);
    expect(html).toContain("ارجاع &lt;کار&gt;");
    expect(html).toContain('href="https://app.example/x"');
    expect(html).toContain("به این ایمیل پاسخ دهید");
    expect(emailLayout({ title: "t", bodyHtml: "", orgName: "o", url: "javascript:x" })).not.toContain("javascript:");
  });

  it("cuts quoted history and signatures from replies", () => {
    expect(stripQuoted("بله، درست شد.\n\nOn Mon, 1 Jan 2026 at 10:00, ITSM <a@b.c> wrote:\n> قبلی")).toBe("بله، درست شد.");
    expect(stripQuoted("ممنون\n-- \nعلی")).toBe("ممنون");
    expect(stripQuoted("پاسخ\n\n-----Original Message-----\nFrom: x")).toBe("پاسخ");
    expect(stripQuoted("پاسخ\n________________________________\nFrom: ITSM\nSent: today")).toBe("پاسخ");
    expect(stripQuoted("> نقل وسط\nپاسخ من")).toBe("> نقل وسط\nپاسخ من");
    expect(stripQuoted("پاسخ\n> نقل\n> پایانی")).toBe("پاسخ");
  });
});

describe("outside channel requests", () => {
  const m = { title: "ارجاع <TODO1>", body: "**متن**", short: "متن کوتاه & بیشتر", url: "https://app.example/r/todo/1", meta: { event: "assigned" } };

  it("speaks each messenger's format", () => {
    const slack = outsideRequest("slack", "https://hooks.slack.example/T/1", null, null, m);
    expect(JSON.parse(String(slack.init.body))).toEqual({ text: "<https://app.example/r/todo/1|ارجاع &lt;TODO1&gt;>\nمتن کوتاه &amp; بیشتر" });
    const tg = outsideRequest("telegram", null, "123:abc", "-100200", m);
    expect(tg.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(String(tg.init.body))).toMatchObject({ chat_id: "-100200", parse_mode: "HTML", text: expect.stringContaining("<b>ارجاع &lt;TODO1&gt;</b>") });
    const bale = outsideRequest("bale", null, "999:x", "42", m);
    expect(bale.url).toBe("https://tapi.bale.ai/bot999:x/sendMessage");
    const teams = JSON.parse(String(outsideRequest("teams", "https://teams.example/hook", null, null, m).init.body));
    expect(teams.attachments[0].content).toMatchObject({ type: "AdaptiveCard", rtl: true });
    expect(JSON.parse(String(outsideRequest("mattermost", "https://mm.example/hooks/x", null, null, m).init.body)).text).toContain("**متن**");
    const hook = outsideRequest("webhook", "https://hooks.example/in", "s3cret", null, m);
    expect((hook.init.headers as Record<string, string>)["x-signature-256"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(String(hook.init.body))).toMatchObject({ title: m.title, url: m.url, event: "assigned" });
  });

  it("fills the SMS gateway template (Kavenegar and Ghasedak presets, JSON bodies)", () => {
    const kv = smsRequest({ ...SMS_PRESETS.kavenegar, sms_sender: "10004346", sms_headers: null }, "KEY/1", { to: "989121234567", text: "سلام & خداحافظ" });
    expect(kv.url).toBe("https://api.kavenegar.com/v1/KEY%2F1/sms/send.json");
    expect(kv.init.body).toBe(`receptor=989121234567&message=${encodeURIComponent("سلام & خداحافظ")}&sender=10004346`);
    const gh = smsRequest({ ...SMS_PRESETS.ghasedak, sms_sender: "3000", sms_headers: SMS_PRESETS.ghasedak.sms_headers! }, "abc", { to: "989121234567", text: "x" });
    expect((gh.init.headers as Record<string, string>).apikey).toBe("abc");
    const js = smsRequest({ ...SMS_PRESETS.generic_json, sms_sender: "1", sms_headers: SMS_PRESETS.generic_json.sms_headers! }, "t", { to: "98912", text: 'نقل "قول"' });
    expect(JSON.parse(String(js.init.body))).toEqual({ to: "98912", text: 'نقل "قول"', from: "1" });
    expect((js.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    const get = smsRequest({ sms_url: "https://sms.example/send?to={{to}}&m={{text}}", sms_method: "GET", sms_content_type: "form", sms_sender: "", sms_body: null, sms_headers: null }, null, { to: "1", text: "a b" });
    expect(get.url).toBe("https://sms.example/send?to=1&m=a%20b");
    expect(get.init.body).toBeUndefined();
  });
});
