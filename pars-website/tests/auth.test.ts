import { beforeAll, describe, expect, it } from "vitest";
import { readResetToken, readSession, resetToken, resetTokenValid, sessionValue } from "@/lib/auth";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-for-sessions-0123456789";
});

describe("session cookie", () => {
  it("round-trips the user id and session version", () => {
    expect(readSession(sessionValue(ID, 3))).toEqual({ id: ID, ver: 3 });
  });
  it("rejects a tampered id, version or signature", () => {
    const [id, exp, ver, sig] = sessionValue(ID, 0).split(".");
    expect(readSession([id.replace("0f8f", "1f8f"), exp, ver, sig].join("."))).toBeNull();
    expect(readSession([id, exp, "1", sig].join("."))).toBeNull();
    expect(readSession([id, String(Number(exp) + 1000), ver, sig].join("."))).toBeNull();
    expect(readSession([id, exp, ver, sig.slice(0, -2) + "xx"].join("."))).toBeNull();
  });
  it("rejects an expired or malformed cookie", () => {
    const old = sessionValue(ID, 0, Date.now() - 31 * 86400_000);
    expect(readSession(old)).toBeNull();
    expect(readSession("")).toBeNull();
    expect(readSession("not-a-session")).toBeNull();
    expect(readSession(`../../etc.1.0.x`)).toBeNull();
  });
  it("stops working when the secret changes", () => {
    const v = sessionValue(ID, 0);
    process.env.APP_SECRET = "another-secret-entirely-9876543210";
    expect(readSession(v)).toBeNull();
    process.env.APP_SECRET = "test-secret-for-sessions-0123456789";
  });
});

describe("password reset token", () => {
  it("is valid for the session version it was made for", () => {
    const t = readResetToken(resetToken(ID, 2))!;
    expect(t.id).toBe(ID);
    expect(resetTokenValid(t, 2)).toBe(true);
  });
  it("dies once the password changes (version bump) or after an hour", () => {
    expect(resetTokenValid(readResetToken(resetToken(ID, 2))!, 3)).toBe(false);
    expect(readResetToken(resetToken(ID, 2, Date.now() - 2 * 3600_000))).toBeNull();
  });
  it("is not interchangeable with a session cookie", () => {
    const [id, exp, , sig] = sessionValue(ID, 0).split(".");
    const t = readResetToken(`${id}.${exp}.${sig}`);
    expect(t && resetTokenValid(t, 0)).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const { checkPassword, hashPassword } = await import("@/lib/auth");
    const h = await hashPassword("رمز-عبور-خوب-1");
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await checkPassword("رمز-عبور-خوب-1", h)).toBe(true);
    expect(await checkPassword("رمز-عبور-خوب-2", h)).toBe(false);
    expect(await checkPassword("anything", null)).toBe(false);
    expect(await checkPassword("anything", "plain-text")).toBe(false);
  });
  it("salts every hash", async () => {
    const { hashPassword } = await import("@/lib/auth");
    expect(await hashPassword("same-password")).not.toBe(await hashPassword("same-password"));
  });
});
