// A kind's ConnCtx for the per-kind tests (design A §17 «discovery-kinds-<kind>»): the real connector fetcher of
// net.ts — host pin, edition rules, declared headers, Persian errors — over the mounted mock tools, with the options
// parsed by the kind's own schema, and `known` (what the connector keeps) when a test gives it.
import type { ConnCtx, ConnectorKind, ConnectorView, KnownItem } from "@server/modules/discovery/kind";
import { connectorFetcher, type NetConfig } from "@server/modules/discovery/net";
import type { Cursor } from "@shared/discovery/types";
import { uuidv7 } from "@shared/id";

/** The web version. */
export const WEB: NetConfig = { mode: "cloud" };

/** The server edition behind an air-gap allowlist (exact names: credentials may go there). */
export function serverEdition(allow: string[]): NetConfig {
  return { mode: "cloud", server: {} as never, network: { lan: true, airGapped: true, allow, onRefused: () => undefined } };
}

export interface KindCtxOptions {
  view?: Partial<ConnectorView>;
  options?: Record<string, unknown>;
  secret?: string | null;
  cfg?: NetConfig;
  deadline?: number;
  now?: Date;
  known?: Map<string, KnownItem>;
}

export function kindCtx(kind: ConnectorKind, o: KindCtxOptions = {}): ConnCtx {
  const options = kind.optionsSchema.parse(o.options ?? {});
  const view: ConnectorView = {
    id: uuidv7(), name: `${kind.label} آزمایشی`, kind: kind.kind, base_url: null, hosts: [], auth: kind.auth[0] ?? null, username: null, api_key_header: null,
    plain_http: false, collect: kind.collects.filter((x) => x !== "software"), mapping: {}, default_class: null, rate_per_second: 100, ca_cert: null, ...o.view, options,
  };
  const secret = o.secret ?? null;
  const f = connectorFetcher(o.cfg ?? WEB, view, kind.headers, { credentialed: !!secret });
  const known = o.known;
  return {
    connector: view, options, secret, secret2: null, edition: "cloud", deadline: o.deadline ?? Date.now() + 600_000, now: () => o.now ?? new Date(),
    fetchJson: f.fetchJson, fetchText: f.fetchText, log: () => undefined,
    ...(known ? { known: async (ids: string[]) => new Map(ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)!])) } : {}),
  };
}

/** Every page of a listing (pages, status or problems), following its cursors. */
export async function allPages<T extends { next: Cursor }>(fn: (cursor: Cursor | null) => Promise<T>, max = 500): Promise<{ pages: T[]; cursors: Cursor[] }> {
  const pages: T[] = [];
  const cursors: Cursor[] = [];
  let cursor: Cursor | null = null;
  for (let i = 0; i < max; i++) {
    const p = await fn(cursor);
    pages.push(p);
    if (p.next === null || p.next === undefined) return { pages, cursors };
    cursor = JSON.parse(JSON.stringify(p.next)) as Cursor;
    cursors.push(cursor);
  }
  throw new Error("listing did not end");
}

/** The Persian message a call ends with ("ok" when it answered). */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}
