import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const SECRET_VARS = ["APP_SECRET", "APP_SECRET_PREVIOUS", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved = Object.fromEntries(SECRET_VARS.map((k) => [k, process.env[k]]));

function setSecrets(v: Partial<Record<(typeof SECRET_VARS)[number], string>>) {
  for (const k of SECRET_VARS) {
    if (v[k] === undefined) delete process.env[k];
    else process.env[k] = v[k];
  }
}

beforeAll(() => {
  setSecrets({ APP_SECRET: "test-secret-0123456789" });
});

afterEach(() => {
  setSecrets({ APP_SECRET: "test-secret-0123456789" });
});

afterAll(() => {
  setSecrets(saved);
});

describe("crypto", () => {
  it("round-trips encrypted secrets and rejects tampering", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const box = encrypt("AIza-secret-key");
    expect(box.startsWith("v1.")).toBe(true);
    expect(decrypt(box)).toBe("AIza-secret-key");
    const parts = box.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(decrypt(parts.join("."))).toBe("");
  });
  it("signs deterministically and compares safely", async () => {
    const { sign, safeEqual } = await import("@/lib/crypto");
    expect(sign("a")).toBe(sign("a"));
    expect(safeEqual(sign("a"), sign("b"))).toBe(false);
  });
});

describe("crypto with older secrets", () => {
  it("keeps values from the service-role fallback readable after APP_SECRET is set", async () => {
    const { encrypt, decrypt, sign } = await import("@/lib/crypto");
    setSecrets({ SUPABASE_SERVICE_ROLE_KEY: "service-role-key" });
    const old = encrypt("ticket-access-key");
    const oldSig = sign("admin");
    setSecrets({ APP_SECRET: "fresh-app-secret", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" });
    expect(decrypt(old)).toBe("ticket-access-key");
    // new values and signatures use only the new secret
    const fresh = encrypt("bot-token");
    expect(sign("admin")).not.toBe(oldSig);
    setSecrets({ APP_SECRET: "fresh-app-secret" });
    expect(decrypt(fresh)).toBe("bot-token");
    expect(decrypt(old)).toBe("");
  });

  it("reads values encrypted with APP_SECRET_PREVIOUS after a rotation", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    setSecrets({ APP_SECRET: "first-secret" });
    const old = encrypt("AIza-old");
    setSecrets({ APP_SECRET: "second-secret" });
    expect(decrypt(old)).toBe("");
    setSecrets({ APP_SECRET: "second-secret", APP_SECRET_PREVIOUS: "first-secret" });
    expect(decrypt(old)).toBe("AIza-old");
    expect(decrypt(encrypt("AIza-new"))).toBe("AIza-new");
  });

  it("returns an empty string when no secret is set", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const box = encrypt("x");
    setSecrets({});
    expect(decrypt(box)).toBe("");
    expect(() => encrypt("x")).toThrow();
  });
});
