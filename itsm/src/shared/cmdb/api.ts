// Contracts of the configuration management API (/api/o/:org/cmdb/…) shared by the server and the screens: the
// dependency map, impact analysis and what-if simulation, the reconciliation engine's items and results, imports, the
// health summary, baseline comparison and merge previews. Restricted CIs travel only as anonymous placeholders.
// Imported by the UI: keep it free of server imports.
import type { ClassFamily, ImpactDir } from "./classes";
import type { SimState, SnapDiff } from "./logic";

export type MapDirection = "both" | "dependents" | "dependencies";

export interface MapOverlay {
  incidents?: number;
  problems?: number;
  changes?: number;
  findings?: number;
  drift?: number;
}

/** A CI on a map (or an anonymous placeholder that keeps a path the caller may see). */
export interface MapNode {
  id: string;
  restricted?: boolean;
  number?: string | null;
  name?: string;
  class?: string;
  class_label?: string;
  family?: ClassFamily;
  icon?: string | null;
  state?: string | null;
  state_label?: string | null;
  operational_status?: string | null;
  criticality?: string | null;
  environment?: string | null;
  health_score?: number | null;
  is_stale?: boolean;
  /** hops from the nearest root */
  depth: number;
  root?: boolean;
  /** neighbours left out because the map reached its size limit */
  more?: number;
  overlay?: MapOverlay;
  /** the service record of a service CI (portfolio) */
  service_id?: string | null;
  /** impact severity (blast radius, 0–1) */
  severity?: number;
  absorbed?: boolean;
}

/** A relationship on a map: `source` is the parent, `target` the child («source <label> target»). */
export interface MapEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  propagates: boolean;
  /** which end depends on the other (for layered layouts): the dependent end sits above */
  dependent: "source" | "target" | null;
  origin?: string | null;
  weight?: number | null;
  ended?: boolean;
}

export interface MapTypeInfo {
  label: string;
  inverse: string;
  color: string | null;
  propagates: boolean;
  impact: ImpactDir;
  category: string | null;
}

export interface MapResult {
  nodes: MapNode[];
  edges: MapEdge[];
  /** the map stopped growing at its size limit */
  truncated: boolean;
  /** CIs on the paths the caller may not read (shown as placeholders) and those left out */
  restricted: number;
  as_of: string | null;
  types: Record<string, MapTypeInfo>;
}

export interface MapQuery {
  roots: string[];
  depth?: number;
  direction?: MapDirection;
  types?: string[];
  classes?: string[];
  as_of?: string | null;
  overlays?: boolean;
  include_hidden?: boolean;
  max_nodes?: number;
}

export interface ImpactQuery {
  ci_ids: string[];
  state?: SimState;
  depth?: number;
  as_of?: string | null;
}

export interface ImpactPathStep {
  id: string;
  name: string;
  restricted?: boolean;
  /** the relationship that led here (from the previous step) */
  type?: string;
  type_label?: string;
}

export interface ImpactedCi {
  id: string;
  number: string | null;
  name: string;
  class: string;
  class_label: string;
  family: ClassFamily;
  severity: number;
  depth: number;
  absorbed?: boolean;
  criticality: string | null;
  environment: string | null;
  owned_by: string | null;
  support_group_id: string | null;
  path: ImpactPathStep[];
}

export interface ImpactedService {
  id: string;
  number: string | null;
  name: string;
  kind: "service" | "offering";
  service_id?: string | null;
  tier: string | null;
  owner_id: string | null;
  state: string | null;
  ci_id: string;
  severity: number;
  on_status_page?: boolean;
}

export interface ImpactResult {
  sources: { id: string; number: string | null; name: string; class: string }[];
  state: SimState;
  cis: ImpactedCi[];
  services: ImpactedService[];
  /** counts the caller may see without names */
  counts: {
    cis: number;
    restricted: number;
    services: number;
    offerings: number;
    critical: number;
    users: number;
    subscribers: number;
    commitments: number;
    open_incidents: number;
    by_class: { class: string; label: string; count: number }[];
  };
  /** the blast radius as a map (sources are roots; severities on the nodes) */
  map: MapResult;
  computed_at: string;
}

export interface ImpactSummary {
  services: number;
  cis: number;
  critical: number;
  text: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Reconciliation engine (identify / createOrUpdate)

/** One item a source reports: its class, CI fields and class attributes (`attrs`), and relationships to other items. */
export interface IreItem {
  class?: string | null;
  values: Record<string, unknown>;
  attrs?: Record<string, unknown> | null;
  /** relationships: to another item of the same payload (`item` index), an existing CI id, or identifying values */
  relations?: IreRelation[];
}

export interface IreRelation {
  type: string;
  /** out: this item is the parent («this <type> other»); in: it is the child */
  direction?: "out" | "in";
  item?: number;
  ci_id?: string;
  match?: { class?: string | null; values: Record<string, unknown> };
}

export type IreAction = "created" | "updated" | "unchanged" | "duplicate" | "skipped" | "error";

export interface IreItemResult {
  index: number;
  action: IreAction;
  ci_id: string | null;
  number: string | null;
  name: string | null;
  /** which identification entry matched («شمارهٔ سریال و سازنده») */
  matched_by?: string | null;
  /** attributes this source may not overwrite (locked, or a more authoritative source owns them) */
  skipped?: string[];
  changed?: string[];
  dedup_task_id?: string | null;
  message?: string | null;
}

export interface IreResult {
  results: IreItemResult[];
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  failed: number;
  relations: { created: number; refreshed: number; failed: number };
  dry_run: boolean;
  run_id?: string | null;
}

export interface IreInput {
  source_id?: string | null;
  items: IreItem[];
  dry_run?: boolean;
  /** an import run to add these results to */
  run_id?: string | null;
  default_class?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Health, baselines, merge

export interface ClassHealth {
  class: string;
  label: string;
  total: number;
  completeness: number;
  correctness: number;
  compliance: number;
  score: number;
  stale: number;
  duplicates: number;
  orphans: number;
  no_owner: number;
}

export interface HealthSummary {
  score: number | null;
  completeness: number | null;
  correctness: number | null;
  compliance: number | null;
  total: number;
  classes: ClassHealth[];
  trend: { day: string; score: number; total: number }[];
  open_findings: number;
  open_dedup: number;
  open_drift: number;
  stale: number;
  computed_at: string | null;
  sources: { id: string; name: string; kind: string; last_run_at: string | null; last_status: string | null }[];
}

export interface CompareResult {
  diff: SnapDiff;
  labels: Record<string, string>;
  before: { label: string; at: string | null };
  after: { label: string; at: string | null };
}

export interface MergePreview {
  survivor: { id: string; number: string | null; name: string };
  absorbed: { id: string; number: string | null; name: string }[];
  /** fields the survivor gets from the absorbed CIs (it had none) */
  fills: { field: string; label: string; value: unknown; from: string }[];
  relations: { move: number; drop: number };
  references: { table: string; label: string; field: string; count: number }[];
  problems: string[];
}

export interface CiPickerHit {
  id: string;
  number: string | null;
  name: string;
  class: string;
  class_label: string;
  state: string | null;
  used_by?: string | null;
  secondary?: string | null;
}

export interface CmdbMeta {
  desktop: boolean;
  can_admin: boolean;
  can_write: boolean;
  ai: string[];
  config: { impact_depth: number; map_max_nodes: number; controlled_mode: string };
}

export interface LocalInventory {
  hostname: string;
  fqdn: string | null;
  platform: string;
  os: string;
  os_version: string;
  arch: string;
  cpu_model: string | null;
  cpu_count: number;
  ram_mb: number;
  ip_address: string | null;
  mac_address: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model_name: string | null;
  bios_uuid: string | null;
  domain: string | null;
  user: string | null;
  disk_gb: number | null;
  software: { name: string; version: string | null; vendor: string | null }[];
  collected_at: string;
  warnings: string[];
}
