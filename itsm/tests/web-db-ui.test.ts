// The web UI when the server cannot answer (1.1.4): Vercel's own 504 page (not JSON) reads as words, not «خطای 504»;
// the session treats a busy, slow or unreachable database as «the server is not ready» (the «آماده‌سازی» screen polls
// /api/health instead of sending the person to sign in); the organisation page offers to try again instead of «no
// access» (src/ui/lib/api.ts, src/ui/lib/session.tsx, src/ui/OrgArea.tsx).
import { describe, it, expect, afterEach, vi } from "vitest";
import { api, ApiError, errorText } from "@ui/lib/api";
import { SERVER_STATES } from "@ui/lib/session";
import { orgErrorView } from "@ui/OrgArea";

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
    expect(orgErrorView("db_read_only")).toEqual({ title: "پایگاه داده فقط‌خواندنی است", retry: false });
    for (const code of ["forbidden", "not_found", null, undefined]) expect(orgErrorView(code)).toEqual({ title: "دسترسی به این سازمان ممکن نیست", retry: false });
  });
});
