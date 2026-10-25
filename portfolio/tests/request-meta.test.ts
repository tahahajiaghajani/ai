import { describe, expect, it } from "vitest";
import { normalizeCode, requestCode } from "@/lib/request-meta";

describe("request codes", () => {
  it("are TA- plus six unambiguous characters", () => {
    const c = requestCode(() => new Uint8Array([0, 1, 2, 3, 250, 255]));
    expect(c).toMatch(/^TA-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });
  it("normalise what people type, Persian digits included", () => {
    expect(normalizeCode(" ta-7k3qx9 ")).toBe("TA-7K3QX9");
    expect(normalizeCode("۷K۳QX۹")).toBe("TA-7K3QX9");
  });
});
