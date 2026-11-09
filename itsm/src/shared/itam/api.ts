// HTTP contracts of IT asset management (/api/o/:org/itam/…), shared by the routes and the screens. Records
// themselves are served by the generic engine API (/r/asset…); these are the module's own operations and views.
import type { Position, StockStatus, TcoResult, WarrantyStatus } from "./logic";

export interface ItamMeta {
  /** may change the module's definitions (models, stockrooms, rules): the area's write grant over all */
  can_manage: boolean;
  /** may approve (disposal, requisitions): the area's approve grant */
  can_approve: boolean;
  /** holds the financial field group (costs, book values) */
  financial: boolean;
  /** reads the software area (licences) / procurement / contracts */
  software: boolean;
  procurement: boolean;
  contracts: boolean;
  ai: string[];
  config: { tag_prefix: string; qr_base_url: string; unused_days: number; label_org: string };
}

export interface ItamDashboard {
  total: number;
  by_state: { state: string; label: string; count: number }[];
  by_category: { category: string; label: string; count: number }[];
  in_stock: number;
  in_use: number;
  missing: number;
  warranty_expiring: number;
  lease_ending: number;
  pending_acks: number;
  stock_alerts: number;
  open_repairs: number;
  pending_disposal: number;
  /** only for holders of the financial field group */
  money: { purchase_cost: string; book_value: string } | null;
  /** only with a read grant in software */
  compliance: { products: number; under_licensed: number; exposure: string | null; savings: string | null; run_at: string | null } | null;
  /** only with a read grant in contracts */
  renewals_90: number | null;
}

export interface MyAsset {
  id: string;
  number: string | null;
  name: string;
  asset_tag: string | null;
  serial_number: string | null;
  model: string | null;
  category: string | null;
  state: string;
  state_label: string;
  substate: string | null;
  usage_type: string | null;
  expected_return_at: string | null;
  assigned_at: string | null;
  warranty_end: string | null;
  ack_state: string | null;
}

export interface MyAck {
  id: string;
  number: string | null;
  asset_id: string;
  asset_label: string;
  terms: string | null;
  requested_at: string | null;
}

export interface MyAssets {
  assets: MyAsset[];
  acks: MyAck[];
  /** members of the caller's team (line manager view, ITAM-009): name and count of assets */
  team: { user_id: string; name: string; count: number }[];
}

export type ReportKind = "lost" | "broken" | "not_mine";

export interface CheckoutInput {
  assigned_to?: string | null;
  location_id?: string | null;
  department_id?: string | null;
  usage_type?: "permanent" | "loaner";
  expected_return_at?: string | null;
  condition?: string | null;
  note?: string | null;
  request_item_id?: string | null;
}

export interface CheckinInput {
  stockroom_id: string;
  condition?: string | null;
  substate?: string | null;
  note?: string | null;
}

export interface TimelineEvent {
  at: string;
  kind: "created" | "state" | "assignment" | "movement" | "repair" | "audit" | "ack" | "disposal" | "cost";
  title: string;
  detail?: string | null;
  link?: { table: string; id: string } | null;
}

export interface Asset360 {
  asset: { id: string; number: string | null; name: string; state: string; state_label: string; substate: string | null };
  timeline: TimelineEvent[];
  assignments: { id: string; assigned_to: string | null; name: string | null; location: string | null; from_at: string; to_at: string | null; usage_type: string | null; condition_in: string | null }[];
  contracts: { id: string; number: string | null; name: string; type: string | null; state: string | null; end_date: string | null; coverage: string | null; supplier: string | null }[];
  warranty: { status: WarrantyStatus; end: string | null; days_left: number | null };
  /** null without the financial field group */
  costs: (TcoResult & { book_value: string | null; accumulated: string | null; entries: { id: string; number: string | null; date: string; description: string; amount: string; source: string }[] }) | null;
  ci: { id: string; number: string | null; name: string; class: string | null; state: string | null; operational_status: string | null; health_score: number | null } | null;
  software: { name: string; version: string | null; model: string | null }[];
}

export interface StockRow {
  model_id: string;
  model: string;
  category: string | null;
  stockroom_id: string;
  stockroom: string;
  available: number;
  reserved: number;
  defective: number;
  total: number;
  rule_id: string | null;
  min_qty: number | null;
  max_qty: number | null;
  status: StockStatus | null;
  order_qty: number;
}

export interface StockDashboard {
  stockrooms: { id: string; name: string; type: string | null; available: number; alerts: number }[];
  rows: StockRow[];
  alerts: StockRow[];
}

export interface ReceiveInput {
  stockroom_id?: string | null;
  lines: { po_line_id: string; quantity: number; serials?: string[]; asset_tags?: string[] }[];
  note?: string | null;
}

export interface ScanResult {
  result: "found" | "moved" | "unexpected" | "duplicate" | "unknown";
  message: string;
  item_id: string | null;
  asset: { id: string; number: string | null; name: string; asset_tag: string | null } | null;
  counts: { expected: number; found: number; missing: number; unexpected: number };
}

export interface CompliancePosition extends Position {
  id: string;
  software_model_id: string;
  model: string;
  publisher: string | null;
  category: string | null;
  model_status: string | null;
}

export interface TrueUpRow {
  entitlement_id: string;
  number: string | null;
  name: string;
  model: string;
  due: string;
  days_left: number;
  entitled: number;
  consumed: number;
  projected: number;
  shortfall: number;
  cost: string | null;
}

export interface Compliance {
  run: { id: string; number: string | null; finished_at: string | null; status: string } | null;
  positions: CompliancePosition[];
  totals: { products: number; compliant: number; under_licensed: number; over_licensed: number; exposure: string | null; savings: string | null };
  trueups: TrueUpRow[];
  /** discovered installs no model matched (top raw names) */
  unmatched: { raw_name: string; publisher: string | null; installs: number }[];
  /** prohibited or restricted software found installed */
  restricted: { model: string; status: string; installs: number }[];
  financial: boolean;
}

export interface LabelAsset {
  id: string;
  number: string | null;
  name: string;
  asset_tag: string | null;
  serial_number: string | null;
  model: string | null;
  location: string | null;
  payload: string;
}

export interface LabelData {
  assets: LabelAsset[];
  templates: { id: string; name: string; is_default: boolean; cols_count: number; rows_count: number; label_width_mm: string; label_height_mm: string; margin_top_mm: string; margin_side_mm: string; gap_x_mm: string; gap_y_mm: string; fields: string[]; title: string | null }[];
}

export interface AiText {
  text: string;
  /** a model wrote it (false: the rule-based answer) */
  ai: boolean;
  model: string | null;
}

export interface RequestItemAssets {
  item: { id: string; number: string | null; requested_for: string | null; state: string };
  models: { id: string; name: string }[];
  assets: { id: string; number: string | null; name: string; asset_tag: string | null; state: string; substate: string | null; assigned_to: string | null }[];
  candidates: { id: string; number: string | null; name: string; asset_tag: string | null; stockroom: string | null }[];
}
