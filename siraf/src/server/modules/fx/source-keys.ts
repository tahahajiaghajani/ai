// Keys of custom price sources (gold board «منبع دلخواه», exchange board «منابع سفارشی»); where they go is described in
// @shared/price-source. tz_price_keys holds one key per business, board and origin («https://api.ezrate.me»): the
// exchange board's rows on one service share it, and it is sent to that origin only. Like AI keys (../ai/crypto.ts) a
// key is encrypted with this runtime's secret and bound to its row (business, board, origin), never synced, never
// returned (only «…abcd»), and refused on the web version without APP_SECRET. Each runtime has its own key: a source
// whose key this runtime lacks is not asked at all, so a quota-limited key saved on one runtime keeps the service there.
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { bad } from "../../http/errors";
import { decryptKey, encryptKey, keyFingerprint, keyHint, keyReadable } from "../ai/crypto";
import { APP_SECRET_MESSAGE, appSecretMissing } from "../ai/connections";
import { securityEvent } from "../platform/security";
import { cleanSourceKey, headerNameProblem, hostOf, KEY_PLACEHOLDER, keyedUrlProblem, needsKey, sourceKeyProblem, sourceOrigin } from "@shared/price-source";

export type KeyBoard = "gold" | "fx";

const PURPOSE = "siraf/price-keys";
const BOARD_FA: Record<KeyBoard, string> = { gold: "تابلوی قیمت طلا", fx: "تابلوی نرخ ارز" };

const binding = (orgId: string, board: KeyBoard, origin: string) => ({ orgId, connectionId: `price:${board}:${origin}` });
const runtimeName = (ctx: Ctx) => (ctx.cfg.mode === "desktop" ? "نسخهٔ ویندوز" : "نسخهٔ وب");

interface KeyRow {
  origin: string;
  secret_enc: string;
  key_hint: string | null;
}

function keyRows(q: Queryable, orgId: string, board: KeyBoard): Promise<KeyRow[]> {
  return q.query<KeyRow>(`select origin, secret_enc, key_hint from tz_price_keys where org_id = $1 and board = $2 order by origin`, [orgId, board]);
}

/** A key as the settings dialogs see it: where it goes and «…abcd», never the key. */
export interface PublicKey {
  origin: string;
  hint: string | null;
  /** saved with another secret (a restored backup, a changed APP_SECRET): type it again */
  unreadable: boolean;
}

export async function publicKeys(ctx: Ctx, board: KeyBoard): Promise<PublicKey[]> {
  const rows = await keyRows(ctx.db, ctx.org.id, board);
  return rows.map((r) => ({ origin: r.origin, hint: r.key_hint, unreadable: !keyReadable(ctx.cfg.secret, binding(ctx.org.id, board, r.origin), r.secret_enc, PURPOSE) }));
}

/** A change from a settings dialog: a new key for an origin, or its removal. */
export interface KeyChange {
  origin: string;
  key?: string | null;
  remove?: boolean | null;
}

/**
 * Store, replace and remove the keys of a board together with its new settings (inside ctx.write). `needed`: the
 * origins whose sources still send a key. A key for any other origin is dropped, so a source moved to another address
 * never takes its old key along. Every change is recorded as a security event («کلید منبع قیمت», hint only).
 */
export async function saveKeys(tx: Tx, ctx: Ctx, board: KeyBoard, changes: KeyChange[], needed: Set<string>): Promise<void> {
  const sealed = new Map<string, { enc: string; hint: string }>();
  const remove = new Set<string>();
  for (const ch of changes) {
    const origin = sourceOrigin(ch.origin);
    if (!origin) throw bad("نشانی کلید معتبر نیست");
    const raw = cleanSourceKey(ch.key);
    if (raw) {
      if (!needed.has(origin)) throw bad(`کلید ${hostOf(origin)}: هیچ منبعی با نام سرآیند یا {key} به این نشانی نیست`);
      const problem = sourceKeyProblem(raw);
      if (problem) throw bad(`کلید ${hostOf(origin)}: ${problem}`);
      if (appSecretMissing(ctx.cfg)) throw bad(APP_SECRET_MESSAGE);
      sealed.set(origin, { enc: encryptKey(ctx.cfg.secret, binding(ctx.org.id, board, origin), raw, PURPOSE), hint: keyHint(raw) });
    } else if (ch.remove) remove.add(origin);
  }
  const before = new Map((await keyRows(tx, ctx.org.id, board)).map((r) => [r.origin, r]));
  const events: { origin: string; action: "added" | "replaced" | "removed"; hint: string | null; reason?: string }[] = [];
  for (const [origin, s] of sealed) {
    await tx.query(
      `insert into tz_price_keys (org_id, board, origin, secret_enc, key_hint, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id, board, origin) do update set secret_enc = excluded.secret_enc, key_hint = excluded.key_hint, updated_by = excluded.updated_by, updated_at = now()`,
      [ctx.org.id, board, origin, s.enc, s.hint, ctx.user.id],
    );
    events.push({ origin, action: before.has(origin) ? "replaced" : "added", hint: s.hint });
  }
  for (const [origin, row] of before) {
    if (sealed.has(origin)) continue;
    // removed in the dialog, or no source sends a key to this origin any more («سرویس یا نشانی عوض شد»)
    const moved = !needed.has(origin);
    if (!remove.has(origin) && !moved) continue;
    await tx.query(`delete from tz_price_keys where org_id = $1 and board = $2 and origin = $3`, [ctx.org.id, board, origin]);
    events.push({ origin, action: "removed", hint: row.key_hint, ...(moved && !remove.has(origin) ? { reason: "destination_changed" } : {}) });
  }
  for (const e of events) {
    await securityEvent(tx, {
      kind: "price_key",
      user_id: ctx.user.id,
      email: ctx.user.email,
      org_id: ctx.org.id,
      data: { board, board_title: BOARD_FA[board], origin: e.origin, action: e.action, key_hint: e.hint, runtime: ctx.cfg.mode, ...(e.reason ? { reason: e.reason } : {}), ...(ctx.actor === "support" ? { support: true } : {}) },
    });
  }
}

/** The origins of `sources` that send a key: their keys are the ones a save keeps. */
export function keyedOrigins(sources: { url: string; header?: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    const origin = needsKey(s) ? sourceOrigin(s.url) : null;
    if (origin) out.add(origin);
  }
  return out;
}

/** Why a source cannot be saved with a key setup (null when it can, or sends none). */
export function keyedSourceProblem(src: { url: string; header?: string | null }): string | null {
  if (!needsKey(src)) return null;
  if (src.header && String(src.header).trim()) {
    const h = headerNameProblem(String(src.header));
    if (h) return h;
  }
  return keyedUrlProblem(src.url);
}

/** A source this runtime cannot ask: its key is missing or unreadable here, or its key setup is not allowed. */
export class SourceKeyError extends Error {}

/** How to ask one source on this runtime. */
export interface SourceRequest {
  /** the address to fetch, {key} filled */
  url: string;
  headers: Record<string, string>;
  /** for the provider cache: the URL as configured, the header name and a fingerprint of the key (never the key) */
  cacheKey: string;
  /** a key rides along: the request must not follow a redirect to another origin */
  keyed: boolean;
}

export type SourceRequests = (src: { url: string; header?: string | null }) => Promise<SourceRequest>;

/**
 * Requests of a board's sources on this runtime; the keys are read once, at the first source that needs one. The
 * settings also arrive by sync, unchecked, so the key setup is checked again before a key goes out.
 */
export function sourceRequests(ctx: Ctx, board: KeyBoard): SourceRequests {
  let rows: Promise<Map<string, KeyRow>> | null = null;
  return async (src) => {
    const url = String(src.url ?? "").trim();
    if (!needsKey(src)) return { url, headers: {}, cacheKey: url, keyed: false };
    const problem = keyedSourceProblem({ url, header: src.header });
    if (problem) throw new SourceKeyError(problem);
    const origin = sourceOrigin(url)!;
    rows ??= keyRows(ctx.db, ctx.org.id, board).then((list) => new Map(list.map((r) => [r.origin, r])));
    const row = (await rows).get(origin);
    if (!row) throw new SourceKeyError(`کلید ${hostOf(origin)} در ${runtimeName(ctx)} ذخیره نشده است`);
    let key: string;
    try {
      key = decryptKey(ctx.cfg.secret, binding(ctx.org.id, board, origin), row.secret_enc, PURPOSE);
    } catch {
      throw new SourceKeyError(`کلید ${hostOf(origin)} در ${runtimeName(ctx)} باز نمی‌شود؛ آن را دوباره وارد کنید`);
    }
    const filled = url.split(KEY_PLACEHOLDER).join(encodeURIComponent(key));
    if (sourceOrigin(filled) !== origin) throw new SourceKeyError("{key} فقط در مسیر یا پارامترهای نشانی می‌آید");
    const header = String(src.header ?? "").trim();
    return {
      url: filled,
      headers: header ? { [header]: key } : {},
      cacheKey: [url, header, keyFingerprint(ctx.cfg.secret, key)].join("\n"),
      keyed: true,
    };
  };
}
