import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentRange, formatRange, parseContentRange, parseRange, resolveRange, sliceStream } from "@/lib/http-range";
import { checkVideoFile, mp4Info, playsEverywhere, rowToVideo, sniffVideo, VIDEO_MAX_BYTES, VIDEO_PATH, videoMimeOf } from "@/lib/video";
import { GET } from "@/app/media/u/[...path]/route";

const bytes = (...xs: (number | string)[]) => {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === "number") out.push(x);
    else for (const ch of x) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
};
const box = (type: string, body: Uint8Array = new Uint8Array(0)) => {
  const len = 8 + body.length;
  return new Uint8Array([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes(type), ...body]);
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const reader = (file: Uint8Array) => async (o: number, l: number) => file.subarray(o, o + l);
const readAll = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());

describe("Range header", () => {
  it("parses single byte ranges", () => {
    expect(parseRange("bytes=0-1")).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=500-")).toEqual({ start: 500 });
    expect(parseRange("bytes=-500")).toEqual({ suffix: 500 });
    expect(parseRange(" Bytes = 10 - 20 ")).toEqual({ start: 10, end: 20 });
  });
  it("ignores what it does not serve (the whole file is sent)", () => {
    for (const h of [null, undefined, "", "bytes=", "bytes=-", "bytes=5-2", "bytes=a-b", "items=0-1", "bytes=0-1,5-9", "bytes=-0", "bytes=1-2-3", "bytes=99999999999999999-"]) expect(parseRange(h)).toBeNull();
  });
  it("resolves against the file size", () => {
    expect(resolveRange({ start: 0, end: 1 }, 1000)).toEqual({ start: 0, end: 1 });
    expect(resolveRange({ start: 990 }, 1000)).toEqual({ start: 990, end: 999 });
    expect(resolveRange({ start: 900, end: 5000 }, 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveRange({ suffix: 100 }, 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveRange({ suffix: 5000 }, 1000)).toEqual({ start: 0, end: 999 });
    expect(resolveRange({ start: 1000 }, 1000)).toBeNull();
    expect(resolveRange({ start: 0 }, 0)).toBeNull();
  });
  it("formats and reads Content-Range", () => {
    expect(formatRange({ start: 5 })).toBe("bytes=5-");
    expect(formatRange({ start: 5, end: 9 })).toBe("bytes=5-9");
    expect(formatRange({ suffix: 7 })).toBe("bytes=-7");
    expect(contentRange({ start: 0, end: 1 }, 1000)).toBe("bytes 0-1/1000");
    expect(parseContentRange("bytes 0-1/1000")).toEqual({ start: 0, end: 1, size: 1000 });
    expect(parseContentRange("bytes */1000")).toEqual({ size: 1000 });
    expect(parseContentRange("bytes 0-1000/1000")).toBeNull();
    expect(parseContentRange("bytes 5-2/1000")).toBeNull();
    expect(parseContentRange("nonsense")).toBeNull();
  });
  it("cuts a range out of a stream read from the start", async () => {
    const data = new Uint8Array(100).map((_, i) => i);
    const chunks = (size: number) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < data.length; i += size) c.enqueue(data.slice(i, i + size));
          c.close();
        },
      });
    for (const size of [1, 7, 100]) {
      expect([...(await readAll(sliceStream(chunks(size), 10, 19)))]).toEqual([...data.slice(10, 20)]);
      expect([...(await readAll(sliceStream(chunks(size), 0, 0)))]).toEqual([0]);
      expect([...(await readAll(sliceStream(chunks(size), 95, 99)))]).toEqual([95, 96, 97, 98, 99]);
    }
  });
});

describe("video upload checks", () => {
  it("accepts MP4 and WebM up to 25 MB", () => {
    expect(checkVideoFile({ type: "video/mp4", name: "a.mp4", size: 1000 })).toBeNull();
    expect(checkVideoFile({ type: "video/webm", name: "a.webm", size: VIDEO_MAX_BYTES })).toBeNull();
    expect(checkVideoFile({ type: "", name: "clip.MP4", size: 10 })).toBeNull();
    expect(videoMimeOf({ type: "", name: "x.webm" })).toBe("video/webm");
  });
  it("refuses other kinds, empty and too large files", () => {
    expect(checkVideoFile({ type: "video/quicktime", name: "a.mov", size: 10 })).toMatch(/MOV/);
    expect(checkVideoFile({ type: "image/gif", name: "a.gif", size: 10 })).toMatch(/MP4/);
    expect(checkVideoFile({ type: "video/mp4", name: "a.mp4", size: 0 })).toMatch(/خالی/);
    expect(checkVideoFile({ type: "video/mp4", name: "a.mp4", size: VIDEO_MAX_BYTES + 1 })).toMatch(/۲۵/);
    expect(checkVideoFile({ type: "video/webm", name: "a.webm", size: 30 * 1048576 })).toContain("۳۰٫۰ مگابایت");
    expect(checkVideoFile({ type: "video/mp4", name: "a.mp4", size: NaN })).not.toBeNull();
  });
  it("recognises the file by its first bytes", () => {
    expect(sniffVideo(box("ftyp", bytes("isom", 0, 0, 2, 0, "isomiso2avc1mp41")))).toBe("mp4");
    expect(sniffVideo(box("ftyp", bytes("qt  ", 0, 0, 0, 0)))).toBeNull();
    const webm = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, "webm", 0x42, 0x87);
    expect(sniffVideo(webm)).toBe("webm");
    const mkv = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, "matroska");
    expect(sniffVideo(mkv)).toBeNull();
    expect(sniffVideo(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
    expect(sniffVideo(new Uint8Array(0))).toBeNull();
  });
  it("finds the codec and the moov position of an MP4", async () => {
    const ftyp = box("ftyp", bytes("isom", 0, 0, 2, 0, "isomavc1"));
    const moovAvc = box("moov", concat(box("mvhd", new Uint8Array(20)), box("trak", box("stsd", concat(new Uint8Array(8), box("avc1", new Uint8Array(30)))))));
    const moovHevc = box("moov", box("trak", box("stsd", concat(new Uint8Array(8), box("hvc1", new Uint8Array(30))))));
    const mdat = box("mdat", new Uint8Array(500));
    const fast = concat(ftyp, moovAvc, mdat);
    expect(await mp4Info(reader(fast), fast.length)).toEqual({ faststart: true, codec: "avc1" });
    const slow = concat(ftyp, mdat, moovAvc);
    expect(await mp4Info(reader(slow), slow.length)).toEqual({ faststart: false, codec: "avc1" });
    const hevc = concat(ftyp, moovHevc, mdat);
    const info = await mp4Info(reader(hevc), hevc.length);
    expect(info?.codec).toBe("hvc1");
    expect(playsEverywhere(info!.codec)).toBe(false);
    expect(playsEverywhere("avc1")).toBe(true);
    expect(await mp4Info(reader(bytes("garbage-not-a-box")), 17)).toBeNull();
  });
  it("maps stored rows to same-origin URLs", () => {
    const path = "v/2f1c0f7e-1b2a-4c3d-9e8f-0123456789ab.mp4";
    expect(VIDEO_PATH.test(path)).toBe(true);
    expect(VIDEO_PATH.test("v/../x.mp4")).toBe(false);
    expect(rowToVideo({ id: "1", path, mime: "video/mp4", width: 720, height: 960, duration: 6.5, bytes: 1234 }, "/media/u")).toEqual({ id: "1", src: `/media/u/${path}`, type: "video/mp4", width: 720, height: 960, duration: 6.5, bytes: 1234 });
    expect(rowToVideo({ id: "1", path: "m/x.mp4", mime: "video/mp4", width: 0, height: 0, duration: 0, bytes: 0 }, "/media/u")).toBeNull();
  });
});

describe("media route streams video with ranges", () => {
  const id = "2f1c0f7e-1b2a-4c3d-9e8f-0123456789ab";
  const file = new Uint8Array(1000).map((_, i) => i % 251);
  const call = (range?: string, p = ["v", `${id}.mp4`]) => GET(new Request("http://site.test/media/u/v/x", { headers: range ? { range } : {} }), { params: Promise.resolve({ path: p }) });
  let honour = true;
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://store.test";
    honour = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes(id)) return new Response("missing", { status: 404 });
        const spec = parseRange(new Headers(init?.headers).get("range"));
        if (!spec || !honour) return new Response(file, { headers: { "content-length": String(file.length), "content-type": "video/mp4" } });
        const r = resolveRange(spec, file.length);
        if (!r) return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.length}` } });
        return new Response(file.slice(r.start, r.end + 1), { status: 206, headers: { "content-range": contentRange(r, file.length), "content-length": String(r.end - r.start + 1) } });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
  });

  for (const mode of ["store honours Range", "store ignores Range"]) {
    it(`answers Safari's probe and later ranges with 206 (${mode})`, async () => {
      honour = mode === "store honours Range";
      const probe = await call("bytes=0-1");
      expect(probe.status).toBe(206);
      expect(probe.headers.get("content-range")).toBe("bytes 0-1/1000");
      expect(probe.headers.get("content-length")).toBe("2");
      expect(probe.headers.get("accept-ranges")).toBe("bytes");
      expect(probe.headers.get("content-type")).toBe("video/mp4");
      expect(probe.headers.get("vary")).toMatch(/range/i);
      expect(probe.headers.get("cache-control")).toMatch(/immutable/);
      expect([...new Uint8Array(await probe.arrayBuffer())]).toEqual([0, 1]);

      const mid = await call("bytes=500-");
      expect(mid.status).toBe(206);
      expect(mid.headers.get("content-range")).toBe("bytes 500-999/1000");
      expect([...new Uint8Array(await mid.arrayBuffer())]).toEqual([...file.slice(500)]);

      const tail = await call("bytes=-10");
      expect(tail.headers.get("content-range")).toBe("bytes 990-999/1000");

      const bad = await call("bytes=5000-");
      expect(bad.status).toBe(416);
      expect(bad.headers.get("content-range")).toBe("bytes */1000");
    });
  }

  it("sends the whole file without a Range header", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe("1000");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
  });

  it("serves only stored video and picture paths", async () => {
    expect((await call(undefined, ["v", "..", "secret.mp4"])).status).toBe(404);
    expect((await call(undefined, ["v", `${id}.mov`])).status).toBe(404);
    expect((await call(undefined, ["v", "2f1c0f7e-1b2a-4c3d-9e8f-000000000000.webm"])).status).toBe(404);
  });
});
