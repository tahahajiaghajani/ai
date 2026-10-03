import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET_KEY = "test-secret-key-for-unit-tests-only-0123456789";
  process.env.CRON_SECRET = "test-cron-secret";
});

describe("secrets and runner tokens", async () => {
  const { decryptSecret, encryptSecret, runnerTokenFor, secretHint, verifyRunnerToken } = await import("@/lib/crypto");
  const user = "6f1c2c1e-1b7a-4c0e-9d8a-0a1b2c3d4e5f";

  it("encrypts and decrypts users' keys", () => {
    const enc = encryptSecret("sk-ant-example");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("sk-ant-example");
    expect(decryptSecret(enc)).toBe("sk-ant-example");
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
    expect(() => decryptSecret(`${enc.slice(0, -4)}AAAA`)).toThrow();
    expect(secretHint("sk-ant-abcdefgh1234")).toBe("••••1234");
  });

  it("binds runner tokens to one user", () => {
    const token = runnerTokenFor(user);
    expect(verifyRunnerToken(token)).toBe(user);
    const other = "6f1c2c1e-1b7a-4c0e-9d8a-0a1b2c3d4e50";
    expect(verifyRunnerToken(token.replace(user, other))).toBeNull();
    expect(verifyRunnerToken("u.x.y")).toBeNull();
  });
});
