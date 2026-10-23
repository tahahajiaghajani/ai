/**
 * HTTP byte ranges (RFC 9110 §14) for streaming video from the site's own /media/u route: Safari and iOS play a
 * <video> only when the server answers `Range: bytes=0-1` with 206 Partial Content. Pure functions (tested).
 * Only a single range is honoured; several ranges or a malformed header are ignored (the whole file is sent),
 * which the RFC allows.
 */

/** `bytes=500-999` → { start: 500, end: 999 }, `bytes=500-` → { start: 500 }, `bytes=-500` → { suffix: 500 }. */
export type RangeSpec = { start: number; end?: number } | { suffix: number };

export interface ByteRange {
  start: number;
  /** inclusive */
  end: number;
}

const MAX = Number.MAX_SAFE_INTEGER;
const digits = (s: string) => (/^\d{1,16}$/.test(s) ? Number(s) : NaN);

export function parseRange(header: string | null | undefined): RangeSpec | null {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*([^,]*?)\s*$/i.exec(header);
  if (!m) return null; // another unit, or several ranges
  const [a, b, extra] = m[1].split("-");
  if (extra !== undefined || a === undefined || b === undefined) return null;
  const first = a.trim();
  const last = b.trim();
  if (!first) {
    const n = digits(last);
    return Number.isFinite(n) && n > 0 && n <= MAX ? { suffix: n } : null;
  }
  const start = digits(first);
  if (!Number.isFinite(start) || start > MAX) return null;
  if (!last) return { start };
  const end = digits(last);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/** The bytes to send of a file of `size` bytes, or null when the range cannot be satisfied (→ 416). */
export function resolveRange(spec: RangeSpec, size: number): ByteRange | null {
  if (!(size > 0)) return null;
  if ("suffix" in spec) return { start: Math.max(0, size - spec.suffix), end: size - 1 };
  if (spec.start >= size) return null;
  return { start: spec.start, end: Math.min(spec.end ?? size - 1, size - 1) };
}

/** The Range header to forward upstream (normalised). */
export function formatRange(spec: RangeSpec): string {
  if ("suffix" in spec) return `bytes=-${spec.suffix}`;
  return `bytes=${spec.start}-${spec.end ?? ""}`;
}

export function contentRange(r: ByteRange, size: number): string {
  return `bytes ${r.start}-${r.end}/${size}`;
}

/** `bytes 0-1/12345` → { start: 0, end: 1, size: 12345 }; the 416 form (a star instead of the range) → { size } only. */
export function parseContentRange(header: string | null | undefined): { start?: number; end?: number; size: number | null } | null {
  if (!header) return null;
  const m = /^\s*bytes\s+(?:(\d+)-(\d+)|\*)\/(\d+|\*)\s*$/i.exec(header);
  if (!m) return null;
  const size = m[3] === "*" ? null : Number(m[3]);
  if (m[1] === undefined) return { size };
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end < start || (size !== null && end >= size)) return null;
  return { start, end, size };
}

/**
 * Cuts bytes [start, end] out of a stream that begins at byte 0 (for an upstream that ignored the Range
 * header). Stops reading once the end is reached.
 */
export function sliceStream(body: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      for (;;) {
        if (pos > end) {
          ctl.close();
          await reader.cancel().catch(() => undefined);
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          ctl.close();
          return;
        }
        const from = pos;
        pos += value.byteLength;
        if (pos <= start) continue; // still before the range
        const a = Math.max(0, start - from);
        const b = Math.min(value.byteLength, end - from + 1);
        if (b > a) {
          ctl.enqueue(value.subarray(a, b));
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
