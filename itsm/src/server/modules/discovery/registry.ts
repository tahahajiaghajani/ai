// The server registry of connector kinds (design A §6.1): one explicit import per wave-1 kind (TypeScript and esbuild
// need one per file — the relay bundles these files too). Every kind is listed; the ones not built yet are stubs that
// refuse with «هنوز ساخته نشده». A kind's package replaces its own connector file and never edits this registry. The
// client-safe twin is @shared/discovery/kinds.
import type { ConnectorKind } from "./kind";
import { connector as zabbix } from "./connectors/zabbix";
import { connector as prtg } from "./connectors/prtg";
import { connector as vcenter } from "./connectors/vcenter";
import { connector as glpi } from "./connectors/glpi";
import { connector as mecm } from "./connectors/mecm";
import { connector as ad_computers } from "./connectors/ad_computers";
import { connector as ksc } from "./connectors/ksc";
import { connector as endpoint_central } from "./connectors/endpoint_central";
import { connector as rest } from "./connectors/rest";
import { connector as feed } from "./connectors/feed";
import { connector as sql_view } from "./connectors/sql_view";
import { connector as push } from "./connectors/push";
import { connector as demo } from "./connectors/demo";

const KINDS: ReadonlyMap<string, ConnectorKind> = new Map([zabbix, prtg, vcenter, glpi, mecm, ad_computers, ksc, endpoint_central, rest, feed, sql_view, push, demo].map((k) => [k.kind, k]));

/** The code of a kind (undefined for a kind this server does not know). */
export function serverKind(kind: string | null | undefined): ConnectorKind | undefined {
  return kind ? KINDS.get(kind) : undefined;
}

/** Every kind this server knows. */
export function serverKinds(): ConnectorKind[] {
  return [...KINDS.values()];
}

/** Tests replace a kind's code (a mock tool's kind) for a while; the returned function puts it back. */
export function overrideKind(kind: ConnectorKind): () => void {
  const map = KINDS as Map<string, ConnectorKind>;
  const before = map.get(kind.kind);
  map.set(kind.kind, kind);
  return () => {
    if (before) map.set(kind.kind, before);
    else map.delete(kind.kind);
  };
}
