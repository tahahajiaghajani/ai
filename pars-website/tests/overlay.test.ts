import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockScroll } from "@/lib/scroll-lock";
import { tabTarget } from "@/components/site/use-overlay";
import { announcement } from "@/components/chat/chat-panel";

describe("lockScroll", () => {
  const html = { style: { overflow: "" } };
  beforeEach(() => vi.stubGlobal("document", { documentElement: html }));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the page locked until the last overlay lets go", () => {
    const menu = lockScroll();
    expect(html.style.overflow).toBe("hidden");
    // the menu's demos button: the menu closes and the sheet opens in one commit (cleanups run first)
    menu();
    const sheet = lockScroll();
    expect(html.style.overflow).toBe("hidden");
    const chat = lockScroll();
    sheet();
    expect(html.style.overflow).toBe("hidden");
    chat();
    expect(html.style.overflow).toBe("");
  });

  it("keeps the sheet locked after the chat's «demos» action (provider and panel both held the lock)", () => {
    const provider = lockScroll(); // taken at once, before the lazy panel has loaded
    const panel = lockScroll();
    // hide() and the sheet's open land in one commit: every cleanup runs before any setup
    panel();
    provider();
    const sheet = lockScroll();
    expect(html.style.overflow).toBe("hidden");
    sheet();
    expect(html.style.overflow).toBe("");
  });

  it("ignores a second release of the same lock", () => {
    const a = lockScroll();
    const b = lockScroll();
    a();
    a();
    expect(html.style.overflow).toBe("hidden");
    b();
    expect(html.style.overflow).toBe("");
  });
});

describe("tabTarget", () => {
  const items = ["close", "link", "send"];

  it("wraps around at both ends", () => {
    expect(tabTarget(items, "send", true, false)).toBe("close");
    expect(tabTarget(items, "close", true, true)).toBe("send");
  });

  it("leaves moves between the ends to the browser", () => {
    expect(tabTarget(items, "close", true, false)).toBeNull();
    expect(tabTarget(items, "send", true, true)).toBeNull();
    expect(tabTarget(items, "link", true, false)).toBeNull();
  });

  it("pulls focus back in from the opener or <body>", () => {
    expect(tabTarget(items, "opener", false, false)).toBe("close");
    expect(tabTarget(items, null, false, true)).toBe("send");
  });

  it("lets the browser move from a focused element it does not list (a scroller)", () => {
    expect(tabTarget(items, "scroller", true, false)).toBeNull();
  });

  it("wraps onto the only element", () => {
    expect(tabTarget(["close"], "close", true, false)).toBe("close");
    expect(tabTarget(["close"], "close", true, true)).toBe("close");
  });
});

describe("announcement", () => {
  it("reads a finished answer as plain text, without markers", () => {
    const content = "### Project Online\n**پارس** شریک *رسمی* است؛ [دموها](https://pars.example.com/demos) و `npm` را ببینید.\n- اول\n- دوم\n[[action:demos]] [[unknown]]";
    expect(announcement({ content, status: "done" })).toBe("Project Online پارس شریک رسمی است؛ دموها و npm را ببینید. اول دوم");
  });

  it("reads the localized error as it is", () => {
    expect(announcement({ content: "ارتباط برقرار نشد؛ **دوباره** امتحان کنید.", status: "error" })).toBe("ارتباط برقرار نشد؛ **دوباره** امتحان کنید.");
  });

  it("is empty for an answer stopped before any text", () => {
    expect(announcement({ content: "[[act", status: "done" })).toBe("");
  });
});
