import { describe, expect, it } from "vitest";
import { folderUrl, mediaUrl, srcSet } from "@/lib/media";
import { sniff } from "@/lib/admin-media";

describe("media urls", () => {
  const m = { src: "/media/seed/x", ext: "webp", widths: [480, 720, 960] };
  it("picks the smallest width that is wide enough", () => {
    expect(mediaUrl(m, 500)).toBe("/media/seed/x/720.webp");
    expect(mediaUrl(m, 2000)).toBe("/media/seed/x/960.webp");
    expect(srcSet(m)).toBe("/media/seed/x/480.webp 480w, /media/seed/x/720.webp 720w, /media/seed/x/960.webp 960w");
  });
  it("maps stored paths", () => {
    expect(folderUrl("/media/seed/x/", "https://p.supabase.co/storage/v1/object/public/celin-media")).toBe("/media/seed/x");
    expect(folderUrl("m/abc", "https://p.supabase.co/storage/v1/object/public/celin-media/")).toBe("https://p.supabase.co/storage/v1/object/public/celin-media/m/abc");
  });
  it("recognises uploads by their bytes", () => {
    expect(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]))).toBe("webp");
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
