// «گردش‌کارها» (design F D13, §8): the settings pages of fields, forms, organisational roles and workflows, and the
// person's own «گردش‌کارها». Each package's folder adds one part (./parts.ts) — list it here, in menu order. The kit's
// components live in ./kit (F5k); the pages of the other packages arrive with their parts:
//   admin/fields, admin/forms, admin/positions (F5) · admin/hub, admin/process, admin/lifecycle (F6) · user (F7).
import type { ModuleUi } from "../registry";
import { assemble } from "./parts";
import { kitPart } from "./kit/routes";
// the position picker and the «پیوست» widget in every record form
import "./kit/register";

export const workflowsUi: ModuleUi = assemble([kitPart]);
