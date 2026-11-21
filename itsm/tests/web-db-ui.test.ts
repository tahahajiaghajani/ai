// The web UI when the server cannot answer (1.1.4): Vercel's own 504 page (not JSON) reads as words, not «خطای 504»;
// the session treats a busy, slow or unreachable database as «the server is not ready» (the «آماده‌سازی» screen polls
// /api/health instead of sending the person to sign in); the organisation page offers to try again instead of «no
// access» (src/ui/lib/api.ts, src/ui/lib/session.tsx, src/ui/OrgArea.tsx).
import { describe, it, expect, afterEach, vi } from "vitest";
import { api, ApiError, errorText } from "@ui/lib/api";
import { blockingServerError, isFirstRun, SERVER_STATES, type Me, type Meta } from "@ui/lib/session";
import { orgBlocked, orgErrorView } from "@ui/OrgArea";
import { pollHealth } from "@ui/pages/auth/Preparing";

const VERCEL_504 = "<!DOCTYPE html><html><head><title>504: GATEWAY_TIMEOUT</title></head><body>An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT</body></html>";

function answer(status: number, body: string, type = "text/html; charset=utf-8") {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "content-type": type } })));
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a gateway's own error page", () => {
  it("504 (the function ran out of time) is «gateway_timeout» in words", async () => {
    answer(504, VERCEL_504);
    const e = await failure(api.get("/o/1"));
    expect(e).toMatchObject({ status: 504, code: "gateway_timeout" });
    expect(errorText(e)).toBe("سرور در زمان مقرر پاسخ نداد (خطای ۵۰۴)؛ چند لحظهٔ دیگر دوباره امتحان کنید");
  });

  it("502 and a bare 503 are «unavailable», with the status in Persian digits", async () => {
    answer(502, "Bad Gateway", "text/plain");
    const bad = await failure(api.post("/o/1/data/x", { a: 1 }));
    expect(bad).toMatchObject({ status: 502, code: "unavailable" });
    expect(bad.message).toBe("سرور اکنون در دسترس نیست (خطای ۵۰۲)؛ چند لحظهٔ دیگر دوباره امتحان کنید");
    answer(503, "");
    const bare = await failure(api.get("/auth/me"));
    expect(bare).toMatchObject({ status: 503, code: "unavailable" });
    expect(bare.message).toBe("سرور اکنون در دسترس نیست (خطای ۵۰۳)؛ چند لحظهٔ دیگر دوباره امتحان کنید");
  });

  it("the same for a streamed answer", async () => {
    answer(504, VERCEL_504);
    const e = await failure(api.stream("/o/1/ai/chat", { q: "x" }));
    expect(e).toMatchObject({ status: 504, code: "gateway_timeout" });
  });

  it("the server's own JSON error is kept as it is (its Persian message and code)", async () => {
    const message = "سامانه اکنون بیش از حد مشغول است و اتصالی به پایگاه داده آزاد نشد؛ چند ثانیهٔ دیگر دوباره امتحان کنید (کد پیگیری: 0a1b2c3d)";
    answer(503, JSON.stringify({ error: { code: "db_busy", message, details: { retry_after_s: 5, db_code: "QUEUE_TIMEOUT", error_id: "0a1b2c3d" } } }), "application/json");
    const e = await failure(api.get("/o/1"));
    expect(e).toMatchObject({ status: 503, code: "db_busy", message });
    // a status without our JSON that is no gateway error stays as it was
    answer(500, "oops", "text/plain");
    expect((await failure(api.get("/x"))).message).toBe("خطای 500");
  });
});

const ME: Me = { user: { id: "u1", email: "owner@example.com", full_name: "مالک", mobile: null, is_platform_admin: false, prefs: {} }, orgs: [] };

describe("a signed-in session is never a first run (UI-1 of the 1.1.4 review)", () => {
  it("only a server without an account, and nobody signed in, sends the app to its first-run setup", () => {
    // a /api/meta that said first_run to a signed-in person sent her round / → /setup → /signup → /, a blank page
    expect(isFirstRun({ first_run: true }, ME)).toBe(false);
    expect(isFirstRun({ first_run: true }, null)).toBe(true);
    expect(isFirstRun({ first_run: true }, undefined)).toBe(true);
    expect(isFirstRun({ first_run: false }, null)).toBe(false);
    expect(isFirstRun(undefined, null)).toBe(false);
  });
});

// A refetch of /auth/me or /meta in the background (a network blip, a window back in focus, an invalidation after a
// save) that met a busy database replaced the whole signed-in app with «سرور آماده نیست», and the typed input went with
// it; the page then asked /api/health once, made the session ask again, and stopped asking — it stayed until «دوباره
// بررسی کن» was clicked, even after the database had recovered (UI-2 of the 1.1.4 review).
describe("a background refetch that meets a busy database keeps the app", () => {
  const META: Meta = { app: "کاریز", version: "1.1.4", mode: "cloud", allow_signup: false, first_run: false, schema: null, signed_in: true, desktop: null };
  const busy = new ApiError(503, "db_busy", "سامانه اکنون بیش از حد مشغول است");

  it("the session gives way to «آماده‌سازی» only without an answer yet, or for the whole deployment's state", () => {
    expect(blockingServerError({ data: ME, error: busy })).toBeNull();
    expect(blockingServerError({ data: META, error: busy }, { data: ME, error: null })).toBeNull();
    expect(blockingServerError({ data: undefined, error: busy })).toBe(busy);
    expect(blockingServerError({ data: META, error: null }, { data: undefined, error: busy })).toBe(busy);
    // a database being prepared or not configured is the whole deployment's: it blocks over data already there
    for (const code of ["migrating", "not_configured"]) {
      const e = new ApiError(503, code, "…");
      expect(blockingServerError({ data: META, error: e }), code).toBe(e);
    }
    // an answer that is no «not ready» never blocks
    expect(blockingServerError({ data: undefined, error: new ApiError(500, "internal", "خطا") })).toBeNull();
  });

  it("the organisation page keeps its shell when a refetch could not reach the server, not when it was refused", () => {
    const org = { org: { id: "o1" } };
    expect(orgBlocked({ data: org, error: busy })).toBe(false);
    expect(orgBlocked({ data: org, error: null })).toBe(false);
    expect(orgBlocked({ data: undefined, error: busy })).toBe(true);
    expect(orgBlocked({ data: undefined, error: null })).toBe(true);
    expect(orgBlocked({ data: org, error: new ApiError(403, "forbidden", "شما به این بخش دسترسی ندارید") })).toBe(true);
  });

  it("«سرور آماده نیست» keeps asking after a healthy answer: it goes away only when the session answers", async () => {
    vi.useFakeTimers();
    try {
      let asks = 0;
      let invalidated = 0;
      const stop = pollHealth({
        ask: async () => {
          asks++;
          return { ok: true, data: { ok: true } };
        },
        invalidate: async () => void invalidated++,
        onState: () => {},
      });
      await vi.advanceTimersByTimeAsync(1_500);
      expect([asks, invalidated]).toEqual([1, 1]);
      // /auth/me was still too busy: the page is still up, and asks again
      await vi.advanceTimersByTimeAsync(3_000);
      expect([asks, invalidated]).toEqual([2, 2]);
      stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(asks).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the session and the organisation page while the server cannot answer", () => {
  it("a busy, slow or unreachable database, a request past its deadline and a gateway error are «the server is not ready»", () => {
    for (const code of ["migrating", "not_configured", "db_unreachable", "db_unavailable", "db_busy", "db_timeout", "timeout", "gateway_timeout", "unavailable"]) expect(SERVER_STATES.has(code), code).toBe(true);
    // a refused or locked write is the request's own answer, and a read-only database still serves reads
    for (const code of ["forbidden", "not_found", "db_locked", "db_read_only", "unauthorized"]) expect(SERVER_STATES.has(code), code).toBe(false);
  });

  it("the organisation page offers to try again when the server could not answer, instead of «no access»", () => {
    for (const code of ["db_busy", "db_timeout", "db_locked", "db_unavailable", "timeout", "retry", "gateway_timeout", "unavailable", "network"]) {
      expect(orgErrorView(code), code).toEqual({ title: "سرور اکنون پاسخ نمی‌دهد", retry: true });
    }
    expect(orgErrorView("db_busy").retry).toBe(true);
    // every answer the session itself takes for «the server is not ready» too: a database being prepared, none
    // configured, one a cold instance cannot reach (UI-7 of the 1.1.4 review: they read «no access», with no retry)
    for (const code of SERVER_STATES) expect(orgErrorView(code), code).toEqual({ title: "سرور اکنون پاسخ نمی‌دهد", retry: true });
    expect(orgErrorView("db_read_only")).toEqual({ title: "پایگاه داده فقط‌خواندنی است", retry: false });
    for (const code of ["forbidden", "not_found", null, undefined]) expect(orgErrorView(code)).toEqual({ title: "دسترسی به این سازمان ممکن نیست", retry: false });
  });
});
